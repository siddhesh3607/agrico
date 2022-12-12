var cookie_settings = {
  // Cookie types:
  //  - Functional
  //  - Analytics (anonymous)
  //  - Marketing
  settings: {
    'is_set': false,
    'allow_functional': true,
    'allow_analytics': false,
    'allow_marketing': false,
    'unset_page_count': 0
  },

  // Initialize cookie settings
  init: function(attr) {
    var self = this;

    // Request all cookie-settings from a previously stored cookie
    if (this.getCookie('cookie_settings_is_set') === 'true') {
      this.settings.is_set = true;

      this.settings.allow_analytics = this.getCookie('cookie_settings_allow_analytics') === 'true';
      this.settings.allow_marketing = this.getCookie('cookie_settings_allow_marketing') === 'true';
      // console.log(this.settings.allow_marketing);
      // console.log(this.getCookie('cookie_settings_allow_marketing'));
      // console.log(this.getCookie('cookie_settings_allow_marketing') === 'true');
      window.addEventListener('load', function () {
        var form = document.querySelector(attr.formSelector);
        if (form) {
          var analytics = form.querySelector('[name="cookie_settings_allow_analytics"]');
          if (analytics) {
            analytics.checked = self.settings.allow_analytics;
          }

          var marketing = form.querySelector('[name="cookie_settings_allow_marketing"]');
          if (marketing) {
            marketing.checked = self.settings.allow_marketing;
          }
        }
      });

    } else {
      // If no settings were stored previously, update the unset page count
      //   When a user ignores the question multiple times, don't show the question again
      if (this.getCookie('cookie_unset_page_count')) {
        this.settings.unset_page_count = parseInt(this.getCookie('cookie_unset_page_count'));
      }
      this.setCookie('cookie_unset_page_count', this.settings.unset_page_count + 1, 1);
    }

    // Show the question bar
    window.addEventListener('load', function() {
      if (!self.settings.is_set && self.settings.unset_page_count < attr.max_unset_page_count) {
        var element = document.querySelector(attr.elementSelector);
        if (element) {
          element.style.display = 'block';
          element.classList.add("show");
        }
      }
    });

    // Update cookie settings on form submit
    window.addEventListener('load', function () {
      var form = document.querySelector(attr.formSelector);
      if (form) {
        form.addEventListener('submit', function(e) {
          self.setCookie('cookie_settings_is_set', true, 365);
          self.settings.is_set = true;

          var analytics = form.querySelector('[name="cookie_settings_allow_analytics"]');
          if (analytics) {
            self.settings.allow_analytics = analytics.checked;
            self.setCookie('cookie_settings_allow_analytics', self.settings.allow_analytics, 365);
          }

          var marketing = form.querySelector('[name="cookie_settings_allow_marketing"]');
          if (marketing) {
            self.settings.allow_marketing = marketing.checked;
            self.setCookie('cookie_settings_allow_marketing', self.settings.allow_marketing, 365);
          }

          attr.callback();

          e.preventDefault();
        });
      }
    });
  },

  // Cookie helper functions
  getCookie: function(name) {
    var v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
    return v ? v[2] : null;
  },

  setCookie: function(name, value, days) {
    var d = new Date;
    d.setTime(d.getTime() + 24 * 60 * 60 * 1000 * days);
    document.cookie = name + '=' + value + ';path=/;expires=' + d.toGMTString();
  },

  /*! loadJS: load a JS file asynchronously.
    [c]2014 @scottjehl, Filament Group, Inc. (Based on http://goo.gl/REQGQ by Paul Irish). Licensed MIT
  */
  loadJS: function (src, cb) {
    'use strict';
    var ref = window.document.getElementsByTagName('script')[0];
    var script = window.document.createElement('script');
    script.src = src;
    script.async = true;
    ref.parentNode.insertBefore(script, ref);
    if (cb && typeof (cb) === 'function') {
      script.onload = cb;
    }
    return script;
  }
};
