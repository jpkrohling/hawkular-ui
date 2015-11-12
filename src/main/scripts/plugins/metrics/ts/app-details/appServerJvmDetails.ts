///
/// Copyright 2015 Red Hat, Inc. and/or its affiliates
/// and other contributors as indicated by the @author tags.
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///    http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

/// <reference path="../metricsPlugin.ts"/>
/// <reference path="../services/alertsManager.ts"/>
/// <reference path="../services/errorsManager.ts"/>

module HawkularMetrics {

  export interface IMultiDataPoint {
    key: string;
    color: string;
    values: IChartDataPoint[];
  }

  export class AppServerJvmDetailsController implements IRefreshable {
    /// this is for minification purposes
    public static $inject = ['$location', '$scope', '$rootScope', '$interval', '$log', '$filter', '$routeParams',
      '$modal', 'HawkularInventory', 'HawkularMetric','HawkularNav', 'HawkularAlertsManager',
      'MetricsService', 'ErrorsManager', '$q', ];

    public static USED_COLOR = '#1884c7'; /// blue
    public static MAXIMUM_COLOR = '#f57f20'; /// orange
    public static COMMITTED_COLOR = '#515252'; /// dark gray

    private static STATUSES = 'OPEN';

    public static MAX_HEAP = 1024 * 1024 * 1024;
    public static BYTES2MB = 1 / 1024 / 1024;

    public math = Math;

    public alertList;
    public resourceId;
    public chartHeapData:IMultiDataPoint[];
    public chartNonHeapData:IMultiDataPoint[];
    public startTimeStamp:TimestampInMillis;
    public endTimeStamp:TimestampInMillis;
    public chartGCDurationData:IChartDataPoint[];
    // will contain in the format: 'metric name' : true | false
    public skipChartData = {};

    constructor(private $location:ng.ILocationService,
                private $scope:any,
                private $rootScope:IHawkularRootScope,
                private $interval:ng.IIntervalService,
                private $log:ng.ILogService,
                private $filter:ng.IFilterService,
                private $routeParams:any,
                private $modal:any,
                private HawkularInventory:any,
                private HawkularMetric:any,
                private HawkularNav:any,
                private HawkularAlertsManager:IHawkularAlertsManager,
                private MetricsService:IMetricsService,
                private ErrorsManager:IErrorsManager,
                private $q:ng.IQService ) {
      $scope.vm = this;

      this.resourceId = this.$routeParams.resourceId;
      this.startTimeStamp = +moment().subtract(($routeParams.timeOffset || 3600000), 'milliseconds');
      this.endTimeStamp = +moment();
      this.chartHeapData = [];
      this.chartNonHeapData = [];

      if ($rootScope.currentPersona) {
        this.getJvmData();
      } else {
        // currentPersona hasn't been injected to the rootScope yet, wait for it..
        $rootScope.$watch('currentPersona',
          (currentPersona) => currentPersona && this.getJvmData());
      }

      // handle drag ranges on charts to change the time range
      this.$scope.$on('ChartTimeRangeChanged', (event, data:Date[]) => {
        this.startTimeStamp = data[0].getTime();
        this.endTimeStamp = data[1].getTime();
        this.HawkularNav.setTimestampStartEnd(this.startTimeStamp, this.endTimeStamp);
        this.refresh();
      });

      this.getAlerts(this.resourceId, this.startTimeStamp, this.endTimeStamp);

      this.autoRefresh(20);
    }

    private getAlerts(metricIdPrefix:string, startTime:TimestampInMillis, endTime:TimestampInMillis):void {
      let pheapArray:any, nheapArray:any, garbaArray:any;
      let pheapPromise = this.HawkularAlertsManager.queryAlerts({
        statuses: AppServerJvmDetailsController.STATUSES,
        triggerIds: metricIdPrefix + '_jvm_pheap', startTime: startTime, endTime: endTime
      }).then((pheapData)=> {
        _.forEach(pheapData.alertList, (item) => {
          item['alertType'] = 'PHEAP';
        });
        pheapArray = pheapData.alertList;
      }, (error) => {
        return this.ErrorsManager.errorHandler(error, 'Error fetching alerts.');
      });

      let nheapPromise = this.HawkularAlertsManager.queryAlerts({
        statuses: AppServerJvmDetailsController.STATUSES,
        triggerIds: metricIdPrefix + '_jvm_nheap', startTime: startTime, endTime: endTime
      }).then((nheapData)=> {
        _.forEach(nheapData.alertList, (item) => {
          item['alertType'] = 'NHEAP';
        });
        nheapArray = nheapData.alertList;
      }, (error) => {
        return this.ErrorsManager.errorHandler(error, 'Error fetching alerts.');
      });

      let garbaPromise = this.HawkularAlertsManager.queryAlerts({
        statuses: AppServerJvmDetailsController.STATUSES,
        triggerIds: metricIdPrefix + '_jvm_garba', startTime: startTime, endTime: endTime
      }).then((garbaData)=> {
        _.forEach(garbaData.alertList, (item) => {
          item['alertType'] = 'GARBA';
        });
        garbaArray = garbaData.alertList;
      }, (error) => {
        return this.ErrorsManager.errorHandler(error, 'Error fetching alerts.');
      });

      this.$q.all([pheapPromise, nheapPromise, garbaPromise]).finally(()=> {
        this.alertList = [].concat(pheapArray, nheapArray, garbaArray);
      });
    }

    private autoRefreshPromise:ng.IPromise<number>;

    private autoRefresh(intervalInSeconds:number):void {
      this.autoRefreshPromise = this.$interval(() => {
       this.refresh();
      }, intervalInSeconds * 1000);

      this.$scope.$on('$destroy', () => {
        this.$interval.cancel(this.autoRefreshPromise);
      });
    }

    public refresh():void {
      this.getJvmData();
      this.getAlerts(this.$routeParams.resourceId, this.startTimeStamp, this.endTimeStamp);
    }

    public getJvmData():void {
      this.endTimeStamp = this.$routeParams.endTime || +moment();
      this.startTimeStamp = this.endTimeStamp - (this.$routeParams.timeOffset || 3600000);

      this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
        'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Heap Used',
        this.startTimeStamp, this.endTimeStamp, 1).then((resource) => {
          if (resource.length) {
            this['heapUsage'] = resource[0];
          }
        });
      this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
        'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Heap Max',
        this.startTimeStamp, this.endTimeStamp, 1).then((resource) => {
          if (resource.length) {
            this['heapMax'] = resource[0];
            AppServerJvmDetailsController.MAX_HEAP = resource[0].max;
          }
        });
      this.MetricsService.retrieveCounterMetrics(this.$rootScope.currentPersona.id,
        'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Accumulated GC Duration',
        this.startTimeStamp, this.endTimeStamp, 1).then((resource) => {
          if (resource.length) {
            this['accGCDuration'] = (resource[0].max - resource[0].min);
          }
        });
      this.getJvmChartData();
    }

    public getJvmChartData():void {

      this.endTimeStamp = this.$routeParams.endTime || +moment();
      this.startTimeStamp = this.endTimeStamp - (this.$routeParams.timeOffset || 3600000);

      let tmpChartHeapData = [];
      let heapPromises = [];
      let tmpChartNonHeapData = [];
      let nonHeapPromises = [];

      if (!this.skipChartData['Heap Committed']) {
        let hCommPromise = this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
          'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Heap Committed',
          this.startTimeStamp, this.endTimeStamp,60);
        heapPromises.push(hCommPromise);
        hCommPromise.then((data) => {
          tmpChartHeapData[tmpChartHeapData.length] = {
            key: 'Heap Committed',
            color: AppServerJvmDetailsController.COMMITTED_COLOR,
            values: MetricsService.formatBucketedChartOutput(data, AppServerJvmDetailsController.BYTES2MB)
          };
        });
      }
      if (!this.skipChartData['Heap Used']) {
        let hUsedPromise = this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
          'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Heap Used',
          this.startTimeStamp, this.endTimeStamp, 60);
        heapPromises.push(hUsedPromise);
        hUsedPromise.then((data) => {
          tmpChartHeapData[tmpChartHeapData.length] = {
            key: 'Heap Used',
            color: AppServerJvmDetailsController.USED_COLOR,
            values: MetricsService.formatBucketedChartOutput(data, AppServerJvmDetailsController.BYTES2MB)
          };
        });
      }
      if (!this.skipChartData['Heap Max']) {
        let hMaxPromise = this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
          'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Heap Max',
          this.startTimeStamp, this.endTimeStamp, 60);
        heapPromises.push(hMaxPromise);
        hMaxPromise.then((data) => {
          tmpChartHeapData[tmpChartHeapData.length] = {
            key: 'Heap Max',
            color: AppServerJvmDetailsController.MAXIMUM_COLOR,
            values: MetricsService.formatBucketedChartOutput(data, AppServerJvmDetailsController.BYTES2MB)
          };
        });
      }
      this.$q.all(heapPromises).finally(()=> {
        this.chartHeapData = tmpChartHeapData;
      });

      if (!this.skipChartData['NonHeap Committed']) {
        let nhCommPromise = this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
          'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~NonHeap Committed',
          this.startTimeStamp, this.endTimeStamp, 60);
        nonHeapPromises.push(nhCommPromise);
        nhCommPromise.then((data) => {
          tmpChartNonHeapData[tmpChartNonHeapData.length] = {
            key: 'NonHeap Committed',
            color: AppServerJvmDetailsController.COMMITTED_COLOR,
            values: MetricsService.formatBucketedChartOutput(data, AppServerJvmDetailsController.BYTES2MB)
          };
        });
      }
      if (!this.skipChartData['NonHeap Used']) {
        let nhUsedPromise = this.MetricsService.retrieveGaugeMetrics(this.$rootScope.currentPersona.id,
          'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~NonHeap Used',
          this.startTimeStamp, this.endTimeStamp, 60);
        nonHeapPromises.push(nhUsedPromise);
        nhUsedPromise.then((data) => {
          tmpChartNonHeapData[tmpChartNonHeapData.length] = {
            key: 'NonHeap Used',
            color: AppServerJvmDetailsController.USED_COLOR,
            values: MetricsService.formatBucketedChartOutput(data, AppServerJvmDetailsController.BYTES2MB)
          };
        });
      }
      this.$q.all(nonHeapPromises).finally(()=> {
        this.chartNonHeapData = tmpChartNonHeapData;
      });

      this.MetricsService.retrieveCounterRateMetrics(this.$rootScope.currentPersona.id,
        'MI~R~[' + this.$routeParams.resourceId + '~~]~MT~WildFly Memory Metrics~Accumulated GC Duration',
        this.startTimeStamp, this.endTimeStamp, 60).then((resource) => {
          if (resource.length) {
            this.chartGCDurationData = MetricsService.formatBucketedChartOutput(resource);
          }
        });
    }

    public toggleChartData(name):void {
      this.skipChartData[name] = !this.skipChartData[name];
      this.getJvmChartData();
    }

  }

  _module.controller('AppServerJvmDetailsController', AppServerJvmDetailsController);

}
