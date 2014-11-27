'use strict';

/* Directives */


angular.module('myApp.directives', ['myApp.filters', 'myApp.directives']).
  directive('appVersion', ['version', function(version) {
    return function(scope, elm, attrs) {
      elm.text(version);
    };
  }]);
