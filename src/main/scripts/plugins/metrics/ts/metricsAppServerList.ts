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

/// <reference path="metricsPlugin.ts"/>
/// <reference path="services/alertsManager.ts"/>
/// <reference path="services/errorsManager.ts"/>

module HawkularMetrics {

  export class AppServerListController {
    /// this is for minification purposes
    public static $inject = ['$location', '$scope', '$rootScope', '$interval', '$log', '$filter', '$modal',
        'HawkularInventory', 'HawkularMetric', 'HawkularAlertsManager', 'ErrorsManager', '$q',
        'md5', 'HkHeaderParser'];

    private resourceList;
    private resPerPage = 10;
    private resCurPage = 0;
    private autoRefreshPromise: ng.IPromise<number>;
    public alertList;
    public headerLinks = {};

    constructor(private $location: ng.ILocationService,
                private $scope: any,
                private $rootScope: any,
                private $interval: ng.IIntervalService,
                private $log: ng.ILogService,
                private $filter: ng.IFilterService,
                private $modal: any,
                private HawkularInventory: any,
                private HawkularMetric: any,
                private HawkularAlertsManager: HawkularMetrics.IHawkularAlertsManager,
                private ErrorsManager: HawkularMetrics.IErrorsManager,
                private $q: ng.IQService,
                private md5: any,
                private HkHeaderParser: HawkularMetrics.IHkHeaderParser,
                public startTimeStamp:TimestampInMillis,
                public endTimeStamp:TimestampInMillis,
                public resourceUrl: string) {
      $scope.vm = this;

      if ($rootScope.currentPersona) {
        this.getResourceList(this.$rootScope.currentPersona.id);
      } else {
        // currentPersona hasn't been injected to the rootScope yet, wait for it..
        $rootScope.$watch('currentPersona', (currentPersona) => currentPersona &&
        this.getResourceList(currentPersona.id));
      }

      this.autoRefresh(20);
    }

    public setPage(page): void {
      this.resCurPage = page;
      this.getResourceList();
    }


    private autoRefresh(intervalInSeconds: number): void {
      this.autoRefreshPromise = this.$interval(() => {
        this.getResourceList();
      }, intervalInSeconds * 1000);

      this.$scope.$on('$destroy', () => {
        this.$interval.cancel(this.autoRefreshPromise);
      });
    }

    public getResourceListForOneFeed(feedId: FeedId, currentTenantId?: TenantId):any {
      let tenantId:TenantId = currentTenantId || this.$rootScope.currentPersona.id;
      this.HawkularInventory.ResourceOfTypeUnderFeed.query({
        environmentId: globalEnvironmentId, feedId: feedId,
        resourceTypeId: 'WildFly Server', per_page: this.resPerPage,
        page: this.resCurPage}, (aResourceList, getResponseHeaders) => {
        this.headerLinks = this.HkHeaderParser.parse(getResponseHeaders());
        let promises = [];
        angular.forEach(aResourceList, function(res) {
          promises.push(this.HawkularMetric.AvailabilityMetricData(tenantId).query({
            availabilityId: 'AI~R~[' + res.id + ']~AT~Server Availability~App Server',
            distinct: true}, (resource) => {
              let latestData = resource[resource.length-1];
              if (latestData) {
                res['state'] = latestData['value'];
                res['updateTimestamp'] = latestData['timestamp'];
              }
          }).$promise);
          promises.push(this.HawkularInventory.ResourceUnderFeed.getData({
            environmentId: globalEnvironmentId,
            feedId: feedId,
            resourcePath: res.id}, (resource) => {
              res['properties']['resourceConfiguration'] = resource;
          }).$promise);
          this.lastUpdateTimestamp = new Date();
        }, this);
        this.$q.all(promises).then((result) => {
          // FIXME this needs to be revisited, this won't work for removed resources
          this.resourceList = _.uniq(_.union(this.resourceList, aResourceList), 'path');
        });
      },
      () => { // error
        if (!this.resourceList) {
          this.resourceList = [];
          this.resourceList.$resolved = true;
          this['lastUpdateTimestamp'] = new Date();
        }
      });
    }

    public getResourceList(currentTenantId?: TenantId):any {
      // for each feed get all WF resources
      let tenantId:TenantId = currentTenantId || this.$rootScope.currentPersona.id;
      this.HawkularInventory.Feed.query({environmentId:globalEnvironmentId},
        (aFeedList) => {
          angular.forEach(aFeedList, (feed) => {
            this.getResourceListForOneFeed(feed.id, tenantId);
          });
          if (!aFeedList.length) {
            // there are no feeds, no app servers
            this.resourceList = [];
            this.resourceList.$resolved = true;
            this['lastUpdateTimestamp'] = new Date();
          }
        });
    }

  }

  _module.controller('AppServerListController', AppServerListController);

}
