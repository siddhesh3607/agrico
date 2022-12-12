"use strict";

function _typeof(obj) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); }

(function () {
  'use strict';

  if ((typeof window === "undefined" ? "undefined" : _typeof(window)) !== 'object') {
    return;
  }

  if ('IntersectionObserver' in window && 'IntersectionObserverEntry' in window && 'intersectionRatio' in window.IntersectionObserverEntry.prototype) {
    if (!('isIntersecting' in window.IntersectionObserverEntry.prototype)) {
      Object.defineProperty(window.IntersectionObserverEntry.prototype, 'isIntersecting', {
        get: function get() {
          return this.intersectionRatio > 0;
        }
      });
    }

    return;
  }

  function getFrameElement(doc) {
    try {
      return doc.defaultView && doc.defaultView.frameElement || null;
    } catch (e) {
      return null;
    }
  }

  var document = function (startDoc) {
    var doc = startDoc;
    var frame = getFrameElement(doc);

    while (frame) {
      doc = frame.ownerDocument;
      frame = getFrameElement(doc);
    }

    return doc;
  }(window.document);

  var registry = [];
  var crossOriginUpdater = null;
  var crossOriginRect = null;

  function IntersectionObserverEntry(entry) {
    this.time = entry.time;
    this.target = entry.target;
    this.rootBounds = ensureDOMRect(entry.rootBounds);
    this.boundingClientRect = ensureDOMRect(entry.boundingClientRect);
    this.intersectionRect = ensureDOMRect(entry.intersectionRect || getEmptyRect());
    this.isIntersecting = !!entry.intersectionRect;
    var targetRect = this.boundingClientRect;
    var targetArea = targetRect.width * targetRect.height;
    var intersectionRect = this.intersectionRect;
    var intersectionArea = intersectionRect.width * intersectionRect.height;

    if (targetArea) {
      this.intersectionRatio = Number((intersectionArea / targetArea).toFixed(4));
    } else {
      this.intersectionRatio = this.isIntersecting ? 1 : 0;
    }
  }

  function IntersectionObserver(callback, opt_options) {
    var options = opt_options || {};

    if (typeof callback != 'function') {
      throw new Error('callback must be a function');
    }

    if (options.root && options.root.nodeType != 1) {
      throw new Error('root must be an Element');
    }

    this._checkForIntersections = throttle(this._checkForIntersections.bind(this), this.THROTTLE_TIMEOUT);
    this._callback = callback;
    this._observationTargets = [];
    this._queuedEntries = [];
    this._rootMarginValues = this._parseRootMargin(options.rootMargin);
    this.thresholds = this._initThresholds(options.threshold);
    this.root = options.root || null;
    this.rootMargin = this._rootMarginValues.map(function (margin) {
      return margin.value + margin.unit;
    }).join(' ');
    this._monitoringDocuments = [];
    this._monitoringUnsubscribes = [];
  }

  IntersectionObserver.prototype.THROTTLE_TIMEOUT = 100;
  IntersectionObserver.prototype.POLL_INTERVAL = null;
  IntersectionObserver.prototype.USE_MUTATION_OBSERVER = true;

  IntersectionObserver._setupCrossOriginUpdater = function () {
    if (!crossOriginUpdater) {
      crossOriginUpdater = function crossOriginUpdater(boundingClientRect, intersectionRect) {
        if (!boundingClientRect || !intersectionRect) {
          crossOriginRect = getEmptyRect();
        } else {
          crossOriginRect = convertFromParentRect(boundingClientRect, intersectionRect);
        }

        registry.forEach(function (observer) {
          observer._checkForIntersections();
        });
      };
    }

    return crossOriginUpdater;
  };

  IntersectionObserver._resetCrossOriginUpdater = function () {
    crossOriginUpdater = null;
    crossOriginRect = null;
  };

  IntersectionObserver.prototype.observe = function (target) {
    var isTargetAlreadyObserved = this._observationTargets.some(function (item) {
      return item.element == target;
    });

    if (isTargetAlreadyObserved) {
      return;
    }

    if (!(target && target.nodeType == 1)) {
      throw new Error('target must be an Element');
    }

    this._registerInstance();

    this._observationTargets.push({
      element: target,
      entry: null
    });

    this._monitorIntersections(target.ownerDocument);

    this._checkForIntersections();
  };

  IntersectionObserver.prototype.unobserve = function (target) {
    this._observationTargets = this._observationTargets.filter(function (item) {
      return item.element != target;
    });

    this._unmonitorIntersections(target.ownerDocument);

    if (this._observationTargets.length == 0) {
      this._unregisterInstance();
    }
  };

  IntersectionObserver.prototype.disconnect = function () {
    this._observationTargets = [];

    this._unmonitorAllIntersections();

    this._unregisterInstance();
  };

  IntersectionObserver.prototype.takeRecords = function () {
    var records = this._queuedEntries.slice();

    this._queuedEntries = [];
    return records;
  };

  IntersectionObserver.prototype._initThresholds = function (opt_threshold) {
    var threshold = opt_threshold || [0];
    if (!Array.isArray(threshold)) threshold = [threshold];
    return threshold.sort().filter(function (t, i, a) {
      if (typeof t != 'number' || isNaN(t) || t < 0 || t > 1) {
        throw new Error('threshold must be a number between 0 and 1 inclusively');
      }

      return t !== a[i - 1];
    });
  };

  IntersectionObserver.prototype._parseRootMargin = function (opt_rootMargin) {
    var marginString = opt_rootMargin || '0px';
    var margins = marginString.split(/\s+/).map(function (margin) {
      var parts = /^(-?\d*\.?\d+)(px|%)$/.exec(margin);

      if (!parts) {
        throw new Error('rootMargin must be specified in pixels or percent');
      }

      return {
        value: parseFloat(parts[1]),
        unit: parts[2]
      };
    });
    margins[1] = margins[1] || margins[0];
    margins[2] = margins[2] || margins[0];
    margins[3] = margins[3] || margins[1];
    return margins;
  };

  IntersectionObserver.prototype._monitorIntersections = function (doc) {
    var win = doc.defaultView;

    if (!win) {
      return;
    }

    if (this._monitoringDocuments.indexOf(doc) != -1) {
      return;
    }

    var callback = this._checkForIntersections;
    var monitoringInterval = null;
    var domObserver = null;

    if (this.POLL_INTERVAL) {
      monitoringInterval = win.setInterval(callback, this.POLL_INTERVAL);
    } else {
      addEvent(win, 'resize', callback, true);
      addEvent(doc, 'scroll', callback, true);

      if (this.USE_MUTATION_OBSERVER && 'MutationObserver' in win) {
        domObserver = new win.MutationObserver(callback);
        domObserver.observe(doc, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    }

    this._monitoringDocuments.push(doc);

    this._monitoringUnsubscribes.push(function () {
      var win = doc.defaultView;

      if (win) {
        if (monitoringInterval) {
          win.clearInterval(monitoringInterval);
        }

        removeEvent(win, 'resize', callback, true);
      }

      removeEvent(doc, 'scroll', callback, true);

      if (domObserver) {
        domObserver.disconnect();
      }
    });

    if (doc != (this.root && this.root.ownerDocument || document)) {
      var frame = getFrameElement(doc);

      if (frame) {
        this._monitorIntersections(frame.ownerDocument);
      }
    }
  };

  IntersectionObserver.prototype._unmonitorIntersections = function (doc) {
    var index = this._monitoringDocuments.indexOf(doc);

    if (index == -1) {
      return;
    }

    var rootDoc = this.root && this.root.ownerDocument || document;

    var hasDependentTargets = this._observationTargets.some(function (item) {
      var itemDoc = item.element.ownerDocument;

      if (itemDoc == doc) {
        return true;
      }

      while (itemDoc && itemDoc != rootDoc) {
        var frame = getFrameElement(itemDoc);
        itemDoc = frame && frame.ownerDocument;

        if (itemDoc == doc) {
          return true;
        }
      }

      return false;
    });

    if (hasDependentTargets) {
      return;
    }

    var unsubscribe = this._monitoringUnsubscribes[index];

    this._monitoringDocuments.splice(index, 1);

    this._monitoringUnsubscribes.splice(index, 1);

    unsubscribe();

    if (doc != rootDoc) {
      var frame = getFrameElement(doc);

      if (frame) {
        this._unmonitorIntersections(frame.ownerDocument);
      }
    }
  };

  IntersectionObserver.prototype._unmonitorAllIntersections = function () {
    var unsubscribes = this._monitoringUnsubscribes.slice(0);

    this._monitoringDocuments.length = 0;
    this._monitoringUnsubscribes.length = 0;

    for (var i = 0; i < unsubscribes.length; i++) {
      unsubscribes[i]();
    }
  };

  IntersectionObserver.prototype._checkForIntersections = function () {
    if (!this.root && crossOriginUpdater && !crossOriginRect) {
      return;
    }

    var rootIsInDom = this._rootIsInDom();

    var rootRect = rootIsInDom ? this._getRootRect() : getEmptyRect();

    this._observationTargets.forEach(function (item) {
      var target = item.element;
      var targetRect = getBoundingClientRect(target);

      var rootContainsTarget = this._rootContainsTarget(target);

      var oldEntry = item.entry;

      var intersectionRect = rootIsInDom && rootContainsTarget && this._computeTargetAndRootIntersection(target, targetRect, rootRect);

      var newEntry = item.entry = new IntersectionObserverEntry({
        time: now(),
        target: target,
        boundingClientRect: targetRect,
        rootBounds: crossOriginUpdater && !this.root ? null : rootRect,
        intersectionRect: intersectionRect
      });

      if (!oldEntry) {
        this._queuedEntries.push(newEntry);
      } else if (rootIsInDom && rootContainsTarget) {
        if (this._hasCrossedThreshold(oldEntry, newEntry)) {
          this._queuedEntries.push(newEntry);
        }
      } else {
        if (oldEntry && oldEntry.isIntersecting) {
          this._queuedEntries.push(newEntry);
        }
      }
    }, this);

    if (this._queuedEntries.length) {
      this._callback(this.takeRecords(), this);
    }
  };

  IntersectionObserver.prototype._computeTargetAndRootIntersection = function (target, targetRect, rootRect) {
    if (window.getComputedStyle(target).display == 'none') return;
    var intersectionRect = targetRect;
    var parent = getParentNode(target);
    var atRoot = false;

    while (!atRoot && parent) {
      var parentRect = null;
      var parentComputedStyle = parent.nodeType == 1 ? window.getComputedStyle(parent) : {};
      if (parentComputedStyle.display == 'none') return null;

      if (parent == this.root || parent.nodeType == 9) {
        atRoot = true;

        if (parent == this.root || parent == document) {
          if (crossOriginUpdater && !this.root) {
            if (!crossOriginRect || crossOriginRect.width == 0 && crossOriginRect.height == 0) {
              parent = null;
              parentRect = null;
              intersectionRect = null;
            } else {
              parentRect = crossOriginRect;
            }
          } else {
            parentRect = rootRect;
          }
        } else {
          var frame = getParentNode(parent);
          var frameRect = frame && getBoundingClientRect(frame);

          var frameIntersect = frame && this._computeTargetAndRootIntersection(frame, frameRect, rootRect);

          if (frameRect && frameIntersect) {
            parent = frame;
            parentRect = convertFromParentRect(frameRect, frameIntersect);
          } else {
            parent = null;
            intersectionRect = null;
          }
        }
      } else {
        var doc = parent.ownerDocument;

        if (parent != doc.body && parent != doc.documentElement && parentComputedStyle.overflow != 'visible') {
          parentRect = getBoundingClientRect(parent);
        }
      }

      if (parentRect) {
        intersectionRect = computeRectIntersection(parentRect, intersectionRect);
      }

      if (!intersectionRect) break;
      parent = parent && getParentNode(parent);
    }

    return intersectionRect;
  };

  IntersectionObserver.prototype._getRootRect = function () {
    var rootRect;

    if (this.root) {
      rootRect = getBoundingClientRect(this.root);
    } else {
      var html = document.documentElement;
      var body = document.body;
      rootRect = {
        top: 0,
        left: 0,
        right: html.clientWidth || body.clientWidth,
        width: html.clientWidth || body.clientWidth,
        bottom: html.clientHeight || body.clientHeight,
        height: html.clientHeight || body.clientHeight
      };
    }

    return this._expandRectByRootMargin(rootRect);
  };

  IntersectionObserver.prototype._expandRectByRootMargin = function (rect) {
    var margins = this._rootMarginValues.map(function (margin, i) {
      return margin.unit == 'px' ? margin.value : margin.value * (i % 2 ? rect.width : rect.height) / 100;
    });

    var newRect = {
      top: rect.top - margins[0],
      right: rect.right + margins[1],
      bottom: rect.bottom + margins[2],
      left: rect.left - margins[3]
    };
    newRect.width = newRect.right - newRect.left;
    newRect.height = newRect.bottom - newRect.top;
    return newRect;
  };

  IntersectionObserver.prototype._hasCrossedThreshold = function (oldEntry, newEntry) {
    var oldRatio = oldEntry && oldEntry.isIntersecting ? oldEntry.intersectionRatio || 0 : -1;
    var newRatio = newEntry.isIntersecting ? newEntry.intersectionRatio || 0 : -1;
    if (oldRatio === newRatio) return;

    for (var i = 0; i < this.thresholds.length; i++) {
      var threshold = this.thresholds[i];

      if (threshold == oldRatio || threshold == newRatio || threshold < oldRatio !== threshold < newRatio) {
        return true;
      }
    }
  };

  IntersectionObserver.prototype._rootIsInDom = function () {
    return !this.root || containsDeep(document, this.root);
  };

  IntersectionObserver.prototype._rootContainsTarget = function (target) {
    return containsDeep(this.root || document, target) && (!this.root || this.root.ownerDocument == target.ownerDocument);
  };

  IntersectionObserver.prototype._registerInstance = function () {
    if (registry.indexOf(this) < 0) {
      registry.push(this);
    }
  };

  IntersectionObserver.prototype._unregisterInstance = function () {
    var index = registry.indexOf(this);
    if (index != -1) registry.splice(index, 1);
  };

  function now() {
    return window.performance && performance.now && performance.now();
  }

  function throttle(fn, timeout) {
    var timer = null;
    return function () {
      if (!timer) {
        timer = setTimeout(function () {
          fn();
          timer = null;
        }, timeout);
      }
    };
  }

  function addEvent(node, event, fn, opt_useCapture) {
    if (typeof node.addEventListener == 'function') {
      node.addEventListener(event, fn, opt_useCapture || false);
    } else if (typeof node.attachEvent == 'function') {
      node.attachEvent('on' + event, fn);
    }
  }

  function removeEvent(node, event, fn, opt_useCapture) {
    if (typeof node.removeEventListener == 'function') {
      node.removeEventListener(event, fn, opt_useCapture || false);
    } else if (typeof node.detatchEvent == 'function') {
      node.detatchEvent('on' + event, fn);
    }
  }

  function computeRectIntersection(rect1, rect2) {
    var top = Math.max(rect1.top, rect2.top);
    var bottom = Math.min(rect1.bottom, rect2.bottom);
    var left = Math.max(rect1.left, rect2.left);
    var right = Math.min(rect1.right, rect2.right);
    var width = right - left;
    var height = bottom - top;
    return width >= 0 && height >= 0 && {
      top: top,
      bottom: bottom,
      left: left,
      right: right,
      width: width,
      height: height
    } || null;
  }

  function getBoundingClientRect(el) {
    var rect;

    try {
      rect = el.getBoundingClientRect();
    } catch (err) {}

    if (!rect) return getEmptyRect();

    if (!(rect.width && rect.height)) {
      rect = {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top
      };
    }

    return rect;
  }

  function getEmptyRect() {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0
    };
  }

  function ensureDOMRect(rect) {
    if (!rect || 'x' in rect) {
      return rect;
    }

    return {
      top: rect.top,
      y: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      x: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height
    };
  }

  function convertFromParentRect(parentBoundingRect, parentIntersectionRect) {
    var top = parentIntersectionRect.top - parentBoundingRect.top;
    var left = parentIntersectionRect.left - parentBoundingRect.left;
    return {
      top: top,
      left: left,
      height: parentIntersectionRect.height,
      width: parentIntersectionRect.width,
      bottom: top + parentIntersectionRect.height,
      right: left + parentIntersectionRect.width
    };
  }

  function containsDeep(parent, child) {
    var node = child;

    while (node) {
      if (node == parent) return true;
      node = getParentNode(node);
    }

    return false;
  }

  function getParentNode(node) {
    var parent = node.parentNode;

    if (node.nodeType == 9 && node != document) {
      return getFrameElement(node);
    }

    if (parent && parent.nodeType == 11 && parent.host) {
      return parent.host;
    }

    if (parent && parent.assignedSlot) {
      return parent.assignedSlot.parentNode;
    }

    return parent;
  }

  window.IntersectionObserver = IntersectionObserver;
  window.IntersectionObserverEntry = IntersectionObserverEntry;
})();

var notification = {
  cookiename: 'notification',
  daysToKeep: 1,
  collection: document.querySelectorAll('.band--notification'),
  init: function init() {
    this.collection.forEach(function (element) {
      var button = element.querySelector('.js-notification-button');
      if (!button) return;
      button.addEventListener('click', function (event) {
        var notificationElement = this.closest('[data-nodeid]');
        notificationElement.className += ' notification-close';
        var closeButtonEvent = notification.whichAnimationEvent();
        closeButtonEvent && notificationElement.addEventListener(closeButtonEvent, function () {
          notification.setCookie(notificationElement.getAttribute('data-nodeid'));
          notificationElement.remove();
        });
        event.preventDefault();
      });
    });
  },
  addDataToCookie: function addDataToCookie(value) {
    var dataToStore = [];
    var originalData = this.getCookie(this.cookiename) !== null ? JSON.parse(this.getCookie(this.cookiename)) : [];

    if (originalData.length > 0) {
      for (var i = 0; i < originalData.length; i++) {
        if (value !== originalData[i]) dataToStore.push(originalData[i]);
      }
    }

    dataToStore.push(value);
    return dataToStore;
  },
  getCookie: function getCookie(name) {
    var myCookie = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
    return myCookie ? myCookie[2] : null;
  },
  setCookie: function setCookie(value) {
    var dataToStore = this.addDataToCookie(value);
    var myDate = new Date();
    myDate.setTime(myDate.getTime() + 24 * 60 * 60 * 1000 * this.daysToKeep);
    document.cookie = this.cookiename + "=" + JSON.stringify(dataToStore) + ";path=/;expires=" + myDate.toGMTString();
  },
  whichAnimationEvent: function whichAnimationEvent() {
    var animation,
        element = document.createElement("fakeelement");
    var animations = {
      "animation": "animationend",
      "OAnimation": "oAnimationEnd",
      "MozAnimation": "animationend",
      "WebkitAnimation": "webkitAnimationEnd"
    };

    for (animation in animations) {
      if (element.style[animation] !== undefined) {
        return animations[animation];
      }
    }
  }
};

(function () {
  notification.init();
})();

(function () {
  var isIE11 = !!window.MSInputMethodContext && !!document.documentMode;

  if (isIE11) {
    document.body.classList.toggle('body--IE11');
  }
})();

if (window.Element && !Element.prototype.closest) {
  Element.prototype.closest = function (s) {
    var matches = (this.document || this.ownerDocument).querySelectorAll(s),
        i,
        el = this;

    do {
      i = matches.length;

      while (--i >= 0 && matches.item(i) !== el) {}

      ;
    } while (i < 0 && (el = el.parentElement));

    return el;
  };
}

if (window.NodeList && !NodeList.prototype.forEach) {
  NodeList.prototype.forEach = Array.prototype.forEach;
}

(function () {
  var formfields = document.querySelectorAll('input[type=text], input[type=number], input[type=tel], input[type=email], textarea');
  var dropdowns = document.querySelectorAll('select');

  if (formfields) {
    for (var i = 0; i < formfields.length; i++) {
      formfields[i].addEventListener('blur', function (event) {
        event.target.classList.add('interacted');
      }, false);
    }
  }

  if (dropdowns) {
    for (i = 0; i < dropdowns.length; i++) {
      dropdowns[i].addEventListener('change', function (event) {
        event.target.classList.add('interacted');
      }, false);
    }
  }
})();

(function () {
  var embedLink = document.querySelectorAll('.js-embed-link');

  if (embedLink) {
    for (var i = 0; i < embedLink.length; i++) {
      embedLink[i].addEventListener('click', function (e) {
        var video = this.parentNode.querySelector('.youtube');
        video.src = video.src + '&autoplay=1&muted=1';
        this.parentNode.classList.add('active');
        e.preventDefault();
      });
    }
  }
})();

function debounce(func, wait) {
  var timeout;
  return function () {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var context = this;
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      return func.apply(context, args);
    }, wait);
  };
}

function onScroll() {
  var autoplayVideo = document.querySelectorAll('.col--media .video--embed');

  if (autoplayVideo) {
    for (var i = 0; i < autoplayVideo.length; i++) {
      var bounding = autoplayVideo[i].getBoundingClientRect();
      var myElementHeight = autoplayVideo[i].offsetHeight;
      var myElementWidth = autoplayVideo[i].offsetWidth;
      var video = autoplayVideo[i].querySelector('.youtube');

      if (window.innerWidth > 1024) {
        if (bounding.top + 300 >= -myElementHeight && bounding.left >= -myElementWidth && bounding.right <= (window.innerWidth || document.documentElement.clientWidth) + myElementWidth && bounding.bottom - 300 <= (window.innerHeight || document.documentElement.clientHeight) + myElementHeight) {
          if (video.src.indexOf('&autoplay=1&muted=1') > -1) {} else {
            autoplayVideo[i].classList.add('active');
            video.src = video.src + '&autoplay=1&muted=1';
          }
        } else {
          if (video.src.indexOf('&autoplay=1&muted=1') > -1) {
            autoplayVideo[i].classList.remove('active');
            video.src = video.src.replace('&autoplay=1&muted=1', '');
          }
        }
      }
    }
  }
}

var autoplayVideo = document.querySelectorAll('.col--media .video--embed');

if (autoplayVideo) {
  window.addEventListener('scroll', debounce(onScroll, 16));
}

(function () {
  document.querySelectorAll('.js-open-navigation').forEach(function (item) {
    item.addEventListener('click', function () {
      document.body.classList.add('body--show-menu');
    });
  });
  document.querySelectorAll('.js-close-navigation').forEach(function (item) {
    item.addEventListener('click', function () {
      document.body.classList.remove('body--show-menu');
    });
  });
})();

(function () {
  document.querySelectorAll('.js-expander').forEach(function (item, index) {
    var content = item.querySelector('.js-expander__content');
    var toggle = item.querySelector('.js-expander__toggle');
    var contentMaxHeight = item.getAttribute('data-max-height') + 'px';
    var contentInnerMarkup = content.innerHTML;
    var wrappedContent;
    if (!content && !toggle) return;
    wrappedContent = "<div class='js-expander__inner'>" + contentInnerMarkup + "</div>";
    content.innerHTML = wrappedContent;
    content.setAttribute('id', 'expander-' + index);
    toggle.removeAttribute('aria-hidden');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-live', 'polite');
    toggle.setAttribute('aria-controls', 'expander-' + index);
    item.setAttribute('role', 'region');
    item.setAttribute('data-is-expanded', false);
    content.style.maxHeight = contentMaxHeight;
    toggle.addEventListener('click', function () {
      var contentOriginalHeight = item.querySelector('.js-expander__inner').clientHeight + 'px';
      var textElement = this.querySelector('.js-expander__text');
      var textExpand = item.getAttribute('data-name-expand');
      var textCollapse = item.getAttribute('data-name-collapse');
      var isExpanded = this.getAttribute('aria-expanded') === "false" ? true : false;
      textElement.innerHTML = isExpanded ? textCollapse : textExpand;
      item.setAttribute('data-is-animating', '');

      this.ontransitionend = function (event) {
        event.stopPropagation();
        item.removeAttribute('data-is-animating');
      };

      item.setAttribute('data-is-expanded', isExpanded);
      this.setAttribute('aria-expanded', isExpanded);
      content.style.maxHeight = item.getAttribute('data-is-expanded') === "false" ? contentMaxHeight : contentOriginalHeight;
    });
  });
})();

function calculateComparisonTableShadowHeight() {
  document.querySelectorAll('.js-comparison-table__set-height').forEach(function (item) {
    var table = item.closest('.js-comparison-table');

    if (table) {
      item.style.height = 'calc(' + table.offsetHeight + 'px' + ' - 4rem)';
    }
  });
}

(function () {
  calculateComparisonTableShadowHeight();
})();

window.addEventListener('resize', calculateComparisonTableShadowHeight);

(function () {
  var sliderPreset1 = document.querySelectorAll('.slider--preset-1 .slider');
  var sliderPreset2 = document.querySelectorAll('.slider--preset-2 .slider');
  var sliderPreset3 = document.querySelectorAll('.slider--preset-3 .slider');
  var sliderPreset4 = document.querySelectorAll('.slider--preset-4 .slider');
  var sliderPreset5 = document.querySelectorAll('.slider--preset-5 .slider');

  if (sliderPreset1) {
    for (var i = 0; i < sliderPreset1.length; i++) {
      tns({
        container: sliderPreset1[i],
        items: 1,
        slideBy: 1,
        edgePadding: 32,
        mouseDrag: true,
        controls: false,
        controlsText: ['<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M257.5 445.1l-22.2 22.2c-9.4 9.4-24.6 9.4-33.9 0L7 273c-9.4-9.4-9.4-24.6 0-33.9L201.4 44.7c9.4-9.4 24.6-9.4 33.9 0l22.2 22.2c9.5 9.5 9.3 25-.4 34.3L136.6 216H424c13.3 0 24 10.7 24 24v32c0 13.3-10.7 24-24 24H136.6l120.5 114.8c9.8 9.3 10 24.8.4 34.3z"></path></svg></span></span>', '<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M190.5 66.9l22.2-22.2c9.4-9.4 24.6-9.4 33.9 0L441 239c9.4 9.4 9.4 24.6 0 33.9L246.6 467.3c-9.4 9.4-24.6 9.4-33.9 0l-22.2-22.2c-9.5-9.5-9.3-25 .4-34.3L311.4 296H24c-13.3 0-24-10.7-24-24v-32c0-13.3 10.7-24 24-24h287.4L190.9 101.2c-9.8-9.3-10-24.8-.4-34.3z"></path></svg></span></span>'],
        nav: true,
        gutter: 0,
        loop: false,
        responsive: {
          600: {
            items: 2
          },
          640: {
            nav: false,
            controls: true,
            edgePadding: 0
          },
          1024: {
            items: 3
          }
        }
      });
    }
  }

  if (sliderPreset2) {
    for (var i = 0; i < sliderPreset2.length; i++) {
      tns({
        container: sliderPreset2[i],
        items: 2,
        slideBy: 1,
        edgePadding: 32,
        autoplay: true,
        mouseDrag: true,
        controls: true,
        nav: false,
        controlsText: ['<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M257.5 445.1l-22.2 22.2c-9.4 9.4-24.6 9.4-33.9 0L7 273c-9.4-9.4-9.4-24.6 0-33.9L201.4 44.7c9.4-9.4 24.6-9.4 33.9 0l22.2 22.2c9.5 9.5 9.3 25-.4 34.3L136.6 216H424c13.3 0 24 10.7 24 24v32c0 13.3-10.7 24-24 24H136.6l120.5 114.8c9.8 9.3 10 24.8.4 34.3z"></path></svg></span></span>', '<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M190.5 66.9l22.2-22.2c9.4-9.4 24.6-9.4 33.9 0L441 239c9.4 9.4 9.4 24.6 0 33.9L246.6 467.3c-9.4 9.4-24.6 9.4-33.9 0l-22.2-22.2c-9.5-9.5-9.3-25 .4-34.3L311.4 296H24c-13.3 0-24-10.7-24-24v-32c0-13.3 10.7-24 24-24h287.4L190.9 101.2c-9.8-9.3-10-24.8-.4-34.3z"></path></svg></span></span>'],
        gutter: 0,
        loop: true,
        responsive: {
          640: {
            items: 3
          },
          1024: {
            edgePadding: 0,
            items: 5
          }
        }
      });
    }
  }

  if (sliderPreset3) {
    for (var i = 0; i < sliderPreset3.length; i++) {
      tns({
        container: sliderPreset3[i],
        items: 1,
        slideBy: 1,
        edgePadding: 32,
        mouseDrag: true,
        controls: false,
        controlsText: ['<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M257.5 445.1l-22.2 22.2c-9.4 9.4-24.6 9.4-33.9 0L7 273c-9.4-9.4-9.4-24.6 0-33.9L201.4 44.7c9.4-9.4 24.6-9.4 33.9 0l22.2 22.2c9.5 9.5 9.3 25-.4 34.3L136.6 216H424c13.3 0 24 10.7 24 24v32c0 13.3-10.7 24-24 24H136.6l120.5 114.8c9.8 9.3 10 24.8.4 34.3z"></path></svg></span></span>', '<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M190.5 66.9l22.2-22.2c9.4-9.4 24.6-9.4 33.9 0L441 239c9.4 9.4 9.4 24.6 0 33.9L246.6 467.3c-9.4 9.4-24.6 9.4-33.9 0l-22.2-22.2c-9.5-9.5-9.3-25 .4-34.3L311.4 296H24c-13.3 0-24-10.7-24-24v-32c0-13.3 10.7-24 24-24h287.4L190.9 101.2c-9.8-9.3-10-24.8-.4-34.3z"></path></svg></span></span>'],
        nav: true,
        gutter: 0,
        loop: false,
        responsive: {
          600: {
            items: 2
          },
          640: {
            edgePadding: 0
          },
          1024: {
            items: 3
          }
        }
      });
    }
  }

  if (sliderPreset4) {
    for (var i = 0; i < sliderPreset4.length; i++) {
      var autoplaySlider = sliderPreset4[i].parentElement.classList.contains('slider--autoplay');
      tns({
        container: sliderPreset4[i],
        items: 1,
        slideBy: 1,
        autoHeight: true,
        autoplay: autoplaySlider,
        autoplayTimeout: 5000,
        edgePadding: 0,
        mouseDrag: true,
        controls: false,
        controlsText: ['<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path d="M34.52 239.03L228.87 44.69c9.37-9.37 24.57-9.37 33.94 0l22.67 22.67c9.36 9.36 9.37 24.52.04 33.9L131.49 256l154.02 154.75c9.34 9.38 9.32 24.54-.04 33.9l-22.67 22.67c-9.37 9.37-24.57 9.37-33.94 0L34.52 272.97c-9.37-9.37-9.37-24.57 0-33.94z"></path></svg></span></span>', '<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path d="M285.476 272.971L91.132 467.314c-9.373 9.373-24.569 9.373-33.941 0l-22.667-22.667c-9.357-9.357-9.375-24.522-.04-33.901L188.505 256 34.484 101.255c-9.335-9.379-9.317-24.544.04-33.901l22.667-22.667c9.373-9.373 24.569-9.373 33.941 0L285.475 239.03c9.373 9.372 9.373 24.568.001 33.941z"></path></svg></span></span>'],
        nav: true,
        gutter: 0,
        loop: true
      });
    }
  }

  if (sliderPreset5) {
    for (var i = 0; i < sliderPreset5.length; i++) {
      var autoplaySlider = sliderPreset5[i].parentElement.classList.contains('slider--autoplay');
      var autoheightSlider = !sliderPreset5[i].parentElement.classList.contains('slider--autoplay');
      tns({
        container: sliderPreset5[i],
        items: 1,
        slideBy: 1,
        autoHeight: autoheightSlider,
        autoplay: autoplaySlider,
        autoplayTimeout: 3000,
        edgePadding: 0,
        mouseDrag: true,
        controls: false,
        controlsText: ['<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path d="M34.52 239.03L228.87 44.69c9.37-9.37 24.57-9.37 33.94 0l22.67 22.67c9.36 9.36 9.37 24.52.04 33.9L131.49 256l154.02 154.75c9.34 9.38 9.32 24.54-.04 33.9l-22.67 22.67c-9.37 9.37-24.57 9.37-33.94 0L34.52 272.97c-9.37-9.37-9.37-24.57 0-33.94z"></path></svg></span></span>', '<span class="tns-controls__button"><span class="icon fill-current"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path d="M285.476 272.971L91.132 467.314c-9.373 9.373-24.569 9.373-33.941 0l-22.667-22.667c-9.357-9.357-9.375-24.522-.04-33.901L188.505 256 34.484 101.255c-9.335-9.379-9.317-24.544.04-33.901l22.667-22.667c9.373-9.373 24.569-9.373 33.941 0L285.475 239.03c9.373 9.372 9.373 24.568.001 33.941z"></path></svg></span></span>'],
        nav: true,
        gutter: 0,
        loop: true
      });
    }
  }
})();

(function () {
  var shareLinks = document.querySelectorAll('.button--share');

  if (shareLinks) {
    var encodePageTitle = encodeURIComponent(document.title);
    var encodePageUrl = encodeURIComponent(window.location.href);

    for (var i = 0; i < shareLinks.length; i++) {
      shareLinks[i].addEventListener('click', function (e) {
        if (this.classList.contains('button--facebook')) {
          window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodePageUrl + '&amp;title=' + encodePageTitle, '_blank');
        }

        if (this.classList.contains('button--twitter')) {
          window.open('http://www.twitter.com/share?url=' + encodePageUrl + '&amp;text= ' + encodePageTitle, '_blank');
        }

        if (this.classList.contains('button--linkedin')) {
          window.open('http://www.linkedin.com/shareArticle?mini=true&url=' + encodePageUrl, '_blank');
        }

        if (this.classList.contains('button--email')) {
          window.open('mailto:yourmail@here.com?subject=Shared Link ' + encodePageTitle + ' &body=' + window.location.href, '_blank');
        }

        if (this.classList.contains('button--whatsapp')) {
          window.open('https://api.whatsapp.com/send/?text=' + encodePageTitle + ' - Agrico (' + window.location.href + ')&type=custom_url&app_absent=0', '_blank');
        }

        e.preventDefault();
      });
    }
  }
})();

(function () {
  var mailLinkv1 = document.querySelectorAll('.js-maillink-v1');
  var mailLinkv2 = document.querySelectorAll('.js-maillink-v2');

  if (mailLinkv1) {
    for (var i = 0; i < mailLinkv1.length; i++) {
      var link = mailLinkv1[i];

      if (link.hasAttribute('data-address')) {
        var mail = link.dataset.address.replace("@@", ".").replace(":", "@");
        link.addEventListener('click', function () {
          this.href = "mailto:" + mail;
        });
        link.addEventListener('touchstart', function () {
          this.href = "mailto:" + mail;
        });
      }
    }
  }

  if (mailLinkv2) {
    for (var i = 0; i < mailLinkv2.length; i++) {
      var link = mailLinkv2[i];

      if (link.hasAttribute('data-address')) {
        var mail = atob(link.dataset.address);
        link.addEventListener('click', function () {
          this.href = "mailto:" + mail;
        });
        link.addEventListener('touchstart', function () {
          this.href = "mailto:" + mail;
        });
      }
    }
  }
})();

(function () {
  var mapsColection = document.querySelectorAll('.js-maps');
  mapsColection.forEach(function (currentMap) {
    var activeCountries = currentMap.getAttribute('data-active');
    var countryCodeArray = activeCountries.split('|');
    countryCodeArray.forEach(function (countryCode) {
      var currentCountry = currentMap.querySelector('[data-id="' + countryCode + '"]');
      if (!currentCountry) return;
      currentCountry.addEventListener('mouseenter', function (event) {
        var name = this.getAttribute('data-name');
        var tooltip = currentMap.querySelector('.js-maps__tooltip');
        if (!tooltip) return;
        tooltip.innerHTML = name;
        tooltip.classList.add('js-maps__tooltip--is-active');
        setTooltipPosition(event, tooltip, currentMap);
        currentCountry.addEventListener('mousemove', function (event) {
          setTooltipPosition(event, tooltip, currentMap);
        });
        currentCountry.addEventListener('mouseleave', function (event) {
          tooltip.classList.remove('js-maps__tooltip--is-active');
        });
      });
    });
  });

  function setTooltipPosition(event, element, currentMap) {
    var boundingBox = currentMap.getBoundingClientRect();
    var xPos = event.clientX - boundingBox.left;
    var yPos = event.clientY - boundingBox.top;
    element.style.left = xPos + "px";
    element.style.top = yPos + "px";
  }

  var makeClickable = {
    init: function init() {
      var element = document.querySelectorAll(".js-clickable");
      Array.prototype.forEach.call(element, function (element) {
        var timer;
        var assignedLink = element.querySelector(".js-clickable__link");
        var link = assignedLink ? assignedLink : element.querySelector("a");
        if (!link) return;
        element.classList.add("js-clickable--enabled");
        link && (element.style.cursor = "pointer", element.onmousedown = function () {
          return timer = +new Date();
        }, element.onmouseup = function () {
          +new Date() - timer < 200 && (event.button ? 0 == event.button && link.click() : link.click());
        });
      });
    }
  };
  var phaseblock = {
    throttleTimeoutObject: false,
    ThrottleDelay: 250,
    button: document.querySelector(".js-phase-button"),
    block: document.querySelector(".js-phase-block"),
    init: function init() {
      if (!this.button) return;
      this.addResizeListener();
      this.resizeCheck();
      this.setStickyContainerHeight();
    },
    setStickyContainerHeight: function setStickyContainerHeight() {
      var stickyContainer = document.querySelector(".js-sticky-container");
      var stickyStop = document.querySelector(".timeline__item--no-phase");
      var stickyContainerHeight = window.pageYOffset + stickyStop.getBoundingClientRect().top - (window.pageYOffset + stickyContainer.getBoundingClientRect().top);

      if (window.innerWidth >= 1024) {
        stickyContainerHeight = stickyContainerHeight + this.block.offsetHeight / 2 + 120;
        stickyContainer.style.top = "auto";
      } else {
        stickyContainerHeight = stickyContainerHeight + stickyStop.offsetHeight / 2;
        stickyContainer.style.top = document.querySelector(".band--potato-value-chain-first .valueinfo").offsetHeight + 60 + "px";
      }

      stickyContainer.style.height = stickyContainerHeight + "px";
    },
    addResizeListener: function addResizeListener() {
      window.addEventListener("resize", function () {
        clearTimeout(phaseblock.throttleTimeoutObject);
        phaseblock.throttleTimeoutObject = setTimeout(phaseblock.resizeCheck(), phaseblock.ThrottleDelay);
      });
    },
    resizeCheck: function resizeCheck() {
      if (window.innerWidth < 1024) {
        if (!phaseblock.button.getAttribute("aria-expanded")) {
          this.block.setAttribute("aria-hidden", true);
          this.block.classList.add("phase--is-hidden");
          phaseblock.showButton();
          phaseblock.button.addEventListener('click', phaseblock.handlePhaseButtonClick, true);
        }
      } else {
        this.block.removeAttribute("aria-hidden");
        this.block.classList.remove("phase--is-hidden");
        phaseblock.hideButton();
        phaseblock.button.removeEventListener('click', phaseblock.handlePhaseButtonClick, true);
      }

      this.setStickyContainerHeight();
    },
    hideButton: function hideButton() {
      this.button.removeAttribute("aria-expanded");
      this.button.removeAttribute("aria-hidden");
      this.button.classList.add("phase__button--is-hidden");
    },
    showButton: function showButton() {
      this.button.setAttribute("aria-expanded", false);
      this.button.setAttribute("aria-hidden", false);
      this.button.classList.remove("phase__button--is-hidden");
      this.button.classList.remove("phase__button--is-expanded");
    },
    handlePhaseButtonClick: function handlePhaseButtonClick() {
      if (phaseblock.button.getAttribute("aria-expanded") === "false") {
        phaseblock.openBlock();
      } else {
        phaseblock.closeBlock();
      }
    },
    closeBlock: function closeBlock() {
      phaseblock.button.setAttribute("aria-expanded", false);
      phaseblock.button.classList.remove("phase__button--is-expanded");
      phaseblock.block.setAttribute("aria-hidden", true);
      phaseblock.block.classList.add("phase--is-hidden");
    },
    openBlock: function openBlock() {
      phaseblock.button.setAttribute("aria-expanded", true);
      phaseblock.button.classList.add("phase__button--is-expanded");
      phaseblock.block.removeAttribute("aria-hidden");
      phaseblock.block.classList.remove("phase--is-hidden");
    }
  };
  makeClickable.init();
  phaseblock.init();
})();

!function () {
  "use strict";

  if ("undefined" != typeof window) {
    var e = window.navigator.userAgent.match(/Edge\/(\d{2})\./),
        n = !!e && 16 <= parseInt(e[1], 10);

    if (!("objectFit" in document.documentElement.style != !1) || n) {
      var o = function o(e) {
        var t = e.parentNode;
        !function (e) {
          var t = window.getComputedStyle(e, null),
              i = t.getPropertyValue("position"),
              n = t.getPropertyValue("overflow"),
              o = t.getPropertyValue("display");
          i && "static" !== i || (e.style.position = "relative"), "hidden" !== n && (e.style.overflow = "hidden"), o && "inline" !== o || (e.style.display = "block"), 0 === e.clientHeight && (e.style.height = "100%"), -1 === e.className.indexOf("object-fit-polyfill") && (e.className = e.className + " object-fit-polyfill");
        }(t), function (e) {
          var t = window.getComputedStyle(e, null),
              i = {
            "max-width": "none",
            "max-height": "none",
            "min-width": "0px",
            "min-height": "0px",
            top: "auto",
            right: "auto",
            bottom: "auto",
            left: "auto",
            "margin-top": "0px",
            "margin-right": "0px",
            "margin-bottom": "0px",
            "margin-left": "0px"
          };

          for (var n in i) {
            t.getPropertyValue(n) !== i[n] && (e.style[n] = i[n]);
          }
        }(e), e.style.position = "absolute", e.style.height = "100%", e.style.width = "auto", e.clientWidth > t.clientWidth ? (e.style.top = "0", e.style.marginTop = "0", e.style.left = "50%", e.style.marginLeft = e.clientWidth / -2 + "px") : (e.style.width = "100%", e.style.height = "auto", e.style.left = "0", e.style.marginLeft = "0", e.style.top = "50%", e.style.marginTop = e.clientHeight / -2 + "px");
      },
          t = function t(e) {
        if (void 0 === e || e instanceof Event) e = document.querySelectorAll("[data-object-fit]");else if (e && e.nodeName) e = [e];else {
          if ("object" != _typeof(e) || !e.length || !e[0].nodeName) return !1;
          e = e;
        }

        for (var t = 0; t < e.length; t++) {
          if (e[t].nodeName) {
            var i = e[t].nodeName.toLowerCase();

            if ("img" === i) {
              if (n) continue;
              e[t].complete ? o(e[t]) : e[t].addEventListener("load", function () {
                o(this);
              });
            } else "video" === i ? 0 < e[t].readyState ? o(e[t]) : e[t].addEventListener("loadedmetadata", function () {
              o(this);
            }) : o(e[t]);
          }
        }

        return !0;
      };

      "loading" === document.readyState ? document.addEventListener("DOMContentLoaded", t) : t(), window.addEventListener("resize", t), window.objectFitPolyfill = t;
    } else window.objectFitPolyfill = function () {
      return !1;
    };
  }
}();
!function (a, b) {
  "use strict";

  function c(a, b) {
    if (!(a instanceof b)) throw new TypeError("Cannot call a class as a function");
  }

  function d(a, b) {
    for (var c in b) {
      b.hasOwnProperty(c) && (a[c] = b[c]);
    }
  }

  function e(a) {
    return parseFloat(a) || 0;
  }

  function f(a) {
    for (var b = 0; a;) {
      b += a.offsetTop, a = a.offsetParent;
    }

    return b;
  }

  function g() {
    function c() {
      a.pageXOffset != m.left ? (m.top = a.pageYOffset, m.left = a.pageXOffset, p.refreshAll()) : a.pageYOffset != m.top && (m.top = a.pageYOffset, m.left = a.pageXOffset, n.forEach(function (a) {
        return a._recalcPosition();
      }));
    }

    function d() {
      f = setInterval(function () {
        n.forEach(function (a) {
          return a._fastCheck();
        });
      }, 500);
    }

    function e() {
      clearInterval(f);
    }

    if (!k) {
      k = !0, c(), a.addEventListener("scroll", c), a.addEventListener("resize", p.refreshAll), a.addEventListener("orientationchange", p.refreshAll);
      var f = void 0,
          g = void 0,
          h = void 0;
      "hidden" in b ? (g = "hidden", h = "visibilitychange") : "webkitHidden" in b && (g = "webkitHidden", h = "webkitvisibilitychange"), h ? (b[g] || d(), b.addEventListener(h, function () {
        b[g] ? e() : d();
      })) : d();
    }
  }

  var h = function () {
    function a(a, b) {
      for (var c = 0; c < b.length; c++) {
        var d = b[c];
        d.enumerable = d.enumerable || !1, d.configurable = !0, "value" in d && (d.writable = !0), Object.defineProperty(a, d.key, d);
      }
    }

    return function (b, c, d) {
      return c && a(b.prototype, c), d && a(b, d), b;
    };
  }(),
      i = !1,
      j = "undefined" != typeof a;

  j && a.getComputedStyle ? !function () {
    var a = b.createElement("div");
    ["", "-webkit-", "-moz-", "-ms-"].some(function (b) {
      try {
        a.style.position = b + "sticky";
      } catch (a) {}

      return "" != a.style.position;
    }) && (i = !0);
  }() : i = !0;

  var k = !1,
      l = "undefined" != typeof ShadowRoot,
      m = {
    top: null,
    left: null
  },
      n = [],
      o = function () {
    function g(a) {
      if (c(this, g), !(a instanceof HTMLElement)) throw new Error("First argument must be HTMLElement");
      if (n.some(function (b) {
        return b._node === a;
      })) throw new Error("Stickyfill is already applied to this node");
      this._node = a, this._stickyMode = null, this._active = !1, n.push(this), this.refresh();
    }

    return h(g, [{
      key: "refresh",
      value: function value() {
        if (!i && !this._removed) {
          this._active && this._deactivate();
          var c = this._node,
              g = getComputedStyle(c),
              h = {
            position: g.position,
            top: g.top,
            display: g.display,
            marginTop: g.marginTop,
            marginBottom: g.marginBottom,
            marginLeft: g.marginLeft,
            marginRight: g.marginRight,
            cssFloat: g.cssFloat
          };

          if (!isNaN(parseFloat(h.top)) && "table-cell" != h.display && "none" != h.display) {
            this._active = !0;
            var j = c.style.position;
            "sticky" != g.position && "-webkit-sticky" != g.position || (c.style.position = "static");
            var k = c.parentNode,
                m = l && k instanceof ShadowRoot ? k.host : k,
                n = c.getBoundingClientRect(),
                o = m.getBoundingClientRect(),
                p = getComputedStyle(m);
            this._parent = {
              node: m,
              styles: {
                position: m.style.position
              },
              offsetHeight: m.offsetHeight
            }, this._offsetToWindow = {
              left: n.left,
              right: b.documentElement.clientWidth - n.right
            }, this._offsetToParent = {
              top: n.top - o.top - e(p.borderTopWidth),
              left: n.left - o.left - e(p.borderLeftWidth),
              right: -n.right + o.right - e(p.borderRightWidth)
            }, this._styles = {
              position: j,
              top: c.style.top,
              bottom: c.style.bottom,
              left: c.style.left,
              right: c.style.right,
              width: c.style.width,
              marginTop: c.style.marginTop,
              marginLeft: c.style.marginLeft,
              marginRight: c.style.marginRight
            };
            var q = e(h.top);
            this._limits = {
              start: n.top + a.pageYOffset - q,
              end: o.top + a.pageYOffset + m.offsetHeight - e(p.borderBottomWidth) - c.offsetHeight - q - e(h.marginBottom)
            };
            var r = p.position;
            "absolute" != r && "relative" != r && (m.style.position = "relative"), this._recalcPosition();
            var s = this._clone = {};
            s.node = b.createElement("div"), d(s.node.style, {
              width: n.right - n.left + "px",
              height: n.bottom - n.top + "px",
              marginTop: h.marginTop,
              marginBottom: h.marginBottom,
              marginLeft: h.marginLeft,
              marginRight: h.marginRight,
              cssFloat: h.cssFloat,
              padding: 0,
              border: 0,
              borderSpacing: 0,
              fontSize: "1em",
              position: "static"
            }), k.insertBefore(s.node, c), s.docOffsetTop = f(s.node);
          }
        }
      }
    }, {
      key: "_recalcPosition",
      value: function value() {
        if (this._active && !this._removed) {
          var a = m.top <= this._limits.start ? "start" : m.top >= this._limits.end ? "end" : "middle";

          if (this._stickyMode != a) {
            switch (a) {
              case "start":
                d(this._node.style, {
                  position: "absolute",
                  left: this._offsetToParent.left + "px",
                  right: this._offsetToParent.right + "px",
                  top: this._offsetToParent.top + "px",
                  bottom: "auto",
                  width: "auto",
                  marginLeft: 0,
                  marginRight: 0,
                  marginTop: 0
                });
                break;

              case "middle":
                d(this._node.style, {
                  position: "fixed",
                  left: this._offsetToWindow.left + "px",
                  right: this._offsetToWindow.right + "px",
                  top: this._styles.top,
                  bottom: "auto",
                  width: "auto",
                  marginLeft: 0,
                  marginRight: 0,
                  marginTop: 0
                });
                break;

              case "end":
                d(this._node.style, {
                  position: "absolute",
                  left: this._offsetToParent.left + "px",
                  right: this._offsetToParent.right + "px",
                  top: "auto",
                  bottom: 0,
                  width: "auto",
                  marginLeft: 0,
                  marginRight: 0
                });
            }

            this._stickyMode = a;
          }
        }
      }
    }, {
      key: "_fastCheck",
      value: function value() {
        this._active && !this._removed && (Math.abs(f(this._clone.node) - this._clone.docOffsetTop) > 1 || Math.abs(this._parent.node.offsetHeight - this._parent.offsetHeight) > 1) && this.refresh();
      }
    }, {
      key: "_deactivate",
      value: function value() {
        var a = this;
        this._active && !this._removed && (this._clone.node.parentNode.removeChild(this._clone.node), delete this._clone, d(this._node.style, this._styles), delete this._styles, n.some(function (b) {
          return b !== a && b._parent && b._parent.node === a._parent.node;
        }) || d(this._parent.node.style, this._parent.styles), delete this._parent, this._stickyMode = null, this._active = !1, delete this._offsetToWindow, delete this._offsetToParent, delete this._limits);
      }
    }, {
      key: "remove",
      value: function value() {
        var a = this;
        this._deactivate(), n.some(function (b, c) {
          if (b._node === a._node) return n.splice(c, 1), !0;
        }), this._removed = !0;
      }
    }]), g;
  }(),
      p = {
    stickies: n,
    Sticky: o,
    forceSticky: function forceSticky() {
      i = !1, g(), this.refreshAll();
    },
    addOne: function addOne(a) {
      if (!(a instanceof HTMLElement)) {
        if (!a.length || !a[0]) return;
        a = a[0];
      }

      for (var b = 0; b < n.length; b++) {
        if (n[b]._node === a) return n[b];
      }

      return new o(a);
    },
    add: function add(a) {
      if (a instanceof HTMLElement && (a = [a]), a.length) {
        for (var b = [], c = function c(_c) {
          var d = a[_c];
          return d instanceof HTMLElement ? n.some(function (a) {
            if (a._node === d) return b.push(a), !0;
          }) ? "continue" : void b.push(new o(d)) : (b.push(void 0), "continue");
        }, d = 0; d < a.length; d++) {
          c(d);
        }

        return b;
      }
    },
    refreshAll: function refreshAll() {
      n.forEach(function (a) {
        return a.refresh();
      });
    },
    removeOne: function removeOne(a) {
      if (!(a instanceof HTMLElement)) {
        if (!a.length || !a[0]) return;
        a = a[0];
      }

      n.some(function (b) {
        if (b._node === a) return b.remove(), !0;
      });
    },
    remove: function remove(a) {
      if (a instanceof HTMLElement && (a = [a]), a.length) for (var b = function b(_b) {
        var c = a[_b];
        n.some(function (a) {
          if (a._node === c) return a.remove(), !0;
        });
      }, c = 0; c < a.length; c++) {
        b(c);
      }
    },
    removeAll: function removeAll() {
      for (; n.length;) {
        n[0].remove();
      }
    }
  };

  i || g(), "undefined" != typeof module && module.exports ? module.exports = p : j && (a.Stickyfill = p);
}(window, document);
var elements = document.querySelectorAll('.js-phase-block');
Stickyfill.add(elements);
var languageswitch = {
  picker: {},
  selectbox: {},
  dropdown: {},
  listId: '',
  switchbutton: {},
  useFlags: false,
  config: {
    selectId: 'languageswitch',
    buttonLabel: 'Select your language',
    globeSvg: '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="currentColor" viewBox="0 0 496 512"><path d="M248 8C111 8 0 119 0 256s111 248 248 248 248-111 248-248S385 8 248 8zm193.2 152h-82.5c-9-44.4-24.1-82.2-43.2-109.1 55 18.2 100.2 57.9 125.7 109.1zM336 256c0 22.9-1.6 44.2-4.3 64H164.3c-2.7-19.8-4.3-41.1-4.3-64s1.6-44.2 4.3-64h167.4c2.7 19.8 4.3 41.1 4.3 64zM248 40c26.9 0 61.4 44.1 78.1 120H169.9C186.6 84.1 221.1 40 248 40zm-67.5 10.9c-19 26.8-34.2 64.6-43.2 109.1H54.8c25.5-51.2 70.7-90.9 125.7-109.1zM32 256c0-22.3 3.4-43.8 9.7-64h90.5c-2.6 20.5-4.2 41.8-4.2 64s1.5 43.5 4.2 64H41.7c-6.3-20.2-9.7-41.7-9.7-64zm22.8 96h82.5c9 44.4 24.1 82.2 43.2 109.1-55-18.2-100.2-57.9-125.7-109.1zM248 472c-26.9 0-61.4-44.1-78.1-120h156.2c-16.7 75.9-51.2 120-78.1 120zm67.5-10.9c19-26.8 34.2-64.6 43.2-109.1h82.5c-25.5 51.2-70.7 90.9-125.7 109.1zM363.8 320c2.6-20.5 4.2-41.8 4.2-64s-1.5-43.5-4.2-64h90.5c6.3 20.2 9.7 41.7 9.7 64s-3.4 43.8-9.7 64h-90.5z"></path></svg>'
  },
  init: function init() {
    this.picker = document.querySelector('[data-language-switch]');
    if (!this.picker) return;
    this.setGlobalVariables();
    this.testForSelectedOption();
    this.picker.insertAdjacentHTML('beforeend', this.createButton() + this.createList());
    this.dropdown = document.querySelector('[data-languageswitch-list]');
    this.hideOriginalSelect();
    this.setListeners();
  },
  setGlobalVariables: function setGlobalVariables() {
    this.useFlags = this.picker.getAttribute('data-languageswitch-useflags') === "true" ? true : false;
    this.selectbox = this.picker.querySelector('select');
    var selectId = this.selectbox.getAttribute('id');
    this.listId = selectId !== null ? selectId + "-list" : this.config.selectId + "-list";
  },
  createButton: function createButton() {
    var attributeValue = this.picker.getAttribute('data-languageswitch-label-button');
    var ariaLabel = attributeValue !== null ? attributeValue : this.config.buttonLabel;
    var flagsClass = this.useFlags ? 'languageswitch__button--use-flags' : '';
    var template = "<button class=\"languageswitch__button ".concat(flagsClass, "\"\n                            data-language-switch-button aria-expanded=\"false\"\n                            aria-label=\"").concat(this.getSelectedOptionText(), " - ").concat(ariaLabel, "\"\n                            aria-controls=\"").concat(this.listId, "\"\n                            lang=\"").concat(this.selectbox.querySelector('option[selected]').getAttribute('lang'), "\"\n                      >\n                      <span class=\"icon languageswitch__icon\" aria-hidden=\"true\">\n                      ").concat(this.config.globeSvg, "\n                      </span>\n                      <span aria-hidden=\"true\" class=\"languageswitch__button-text\">\n                        ").concat(this.getSelectedOptionText(), "\n                      </span>\n                    </button>\n                    ");
    return template;
  },
  createList: function createList() {
    var flagsClass = this.useFlags ? 'languageswitch__link--use-flags' : '';
    var list = "<div class=\"languageswitch__dropdown\" data-language-switch-dropdown aria-describedby=\"".concat(this.listId, "-description\" id=\"").concat(this.listId, "\" aria-hidden=\"true\" hidden>\n                  <p class=\"sr-only\" id=\"").concat(this.listId, "-description\">").concat(this.picker.querySelector('label').textContent, "</p>\n                  <ul class=\"languageswitch__list\" role=\"listbox\" data-languageswitch-list>");

    for (var i = 0; i < this.selectbox.options.length; i++) {
      var selected = this.selectbox.options[i].selected ? ' aria-selected="true"' : '';
      var language = this.selectbox.options[i].getAttribute('lang');
      var link = this.selectbox.options[i].getAttribute('data-link');
      list = list + "<li class=\"languageswitch__item\">\n                      <a lang=\"".concat(language, "\" hreflang=\"").concat(language, "\" href=\"").concat(link, "\" ").concat(selected, "\n                          role=\"option\" data-value=\"").concat(this.selectbox.options[i].value, "\"\n                          class=\"languageswitch__link ").concat(flagsClass, "\">\n                        <span class=\"languageswitch__link-text\">").concat(this.selectbox.options[i].text, "</span>\n                      </a>\n                    </li>\n                    ");
    }

    ;
    return "".concat(list, "</ul></div>");
  },
  hideOriginalSelect: function hideOriginalSelect() {
    var element = this.picker.querySelector('form');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('hidden', '');
    element.style.display = 'none';
  },
  getSelectedOptionText: function getSelectedOptionText() {
    return this.selectbox.querySelector('option[selected]').text;
  },
  testForSelectedOption: function testForSelectedOption() {
    var selectedOption = this.selectbox.querySelector('option[selected]');

    if (!selectedOption) {
      this.selectbox.querySelectorAll('option')[0].setAttribute('selected', "");
    }
  },
  setListeners: function setListeners() {
    this.switchbutton = this.picker.querySelector('[data-language-switch-button]');
    this.switchbutton.addEventListener('click', languageswitch.handleButtonClick);
  },
  handleButtonClick: function handleButtonClick() {
    var element = languageswitch.switchbutton;
    var target = document.getElementById(element.getAttribute('aria-controls'));
    var state = element.getAttribute('aria-expanded') === 'true' ? false : true;
    element.setAttribute('aria-expanded', state);
    target.setAttribute('aria-hidden', !state);

    if (state) {
      target.removeAttribute('hidden');
      languageswitch.addEventListeners();
      languageswitch.dropdown.querySelector('li a').focus();
    } else {
      target.setAttribute('hidden', '');
      languageswitch.removeEventListeners();
      element.focus();
    }
  },
  addEventListeners: function addEventListeners() {
    window.addEventListener('keyup', languageswitch.handleKeys);
    window.addEventListener('click', languageswitch.checkOutsideClick);
    languageswitch.dropdown.addEventListener('keydown', languageswitch.handleArrows, true);
  },
  removeEventListeners: function removeEventListeners() {
    window.removeEventListener('keyup', languageswitch.handleKeys);
    window.removeEventListener('click', languageswitch.checkOutsideClick);
    languageswitch.dropdown.removeEventListener('keydown', languageswitch.handleArrows, true);
  },
  handleKeys: function handleKeys(event) {
    if (event.keyCode && event.keyCode == 27 || event.key && event.key.toLowerCase() == 'escape') {
      languageswitch.handleButtonClick();
    }
  },
  handleArrows: function handleArrows(event) {
    event.preventDefault();

    if (event.keyCode && event.keyCode == 38 || event.key && event.key.toLowerCase() == 'arrowup') {
      languageswitch.moveArrowFocus('up');
    } else if (event.keyCode && event.keyCode == 40 || event.key && event.key.toLowerCase() == 'arrowdown') {
      languageswitch.moveArrowFocus('down');
    }
  },
  moveArrowFocus: function moveArrowFocus(direction) {
    var listItems = languageswitch.dropdown.querySelectorAll('li a');
    var listItemsArray = Array.prototype.slice.call(listItems);
    var index = listItemsArray.indexOf(document.activeElement);
    index = direction == 'down' ? index + 1 : index - 1;
    if (index < 0) index = listItemsArray.length - 1;
    if (index >= listItemsArray.length) index = 0;
    listItems.item(index).focus();
  },
  checkOutsideClick: function checkOutsideClick(event) {
    if (!languageswitch.picker.contains(event.target)) languageswitch.handleButtonClick();
  }
};
languageswitch.init();

function moveLanguageSwitch() {
  var languagePicker = document.querySelector('.languageswitch');
  var newLocation = document.querySelector('.menu__item--language');

  if (window.innerWidth < 1024) {
    var newLocation = document.querySelector('.col--logo');
  }

  newLocation.insertBefore(languagePicker, newLocation.firstChild);
}

var languagePicker = document.querySelector('.languageswitch');

if (languagePicker) {
  moveLanguageSwitch();
  window.addEventListener('resize', moveLanguageSwitch);
}

var clickableVideoObject = {
  init: function init() {
    var videoCollection = document.querySelectorAll('[data-video-url]');
    if (!videoCollection) return;
    clickableVideoObject.addEventListeners(videoCollection);
  },
  addEventListeners: function addEventListeners(videoCollection) {
    for (var i = 0; i < videoCollection.length; i++) {
      videoCollection[i].addEventListener('click', clickableVideoObject.handleVideoClick);
    }
  },
  handleVideoClick: function handleVideoClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    var element = event.currentTarget;
    if (!element.hasAttribute('data-video-not-played')) return;
    var image = element.querySelector('img');
    if (image) image.remove();
    var videoUrl = element.getAttribute('data-video-url');
    element.removeAttribute('data-video-not-played');
    if (!videoUrl) return;
    var video = clickableVideoObject.makeVideoObject(videoUrl);
    element.appendChild(video);
    this.removeEventListener('click', clickableVideoObject.handleVideoClick);
    video.click();
  },
  makeVideoObject: function makeVideoObject(videoUrl) {
    var element = document.createElement("VIDEO");
    element.classList.add('video');
    element.setAttribute('controls', '');
    element.setAttribute('loop', '1');
    element.setAttribute('autoplay', '1');
    element.setAttribute('poster', '');
    element.setAttribute('playsinline', '');
    element.setAttribute('webkit-playsinline', '');
    element.setAttribute('src', videoUrl);
    element.setAttribute('type', 'video/mp4');
    return element;
  }
};
clickableVideoObject.init();

function scrolltoToggle(location) {
  var currentLocation = document.querySelector('.js-gototarget[data-location="' + location + '"]');
  var currentAccordion = currentLocation.closest('[data-accordion-item]');

  if (currentAccordion) {
    setTimeout(function () {
      var getOffsetTop = function getOffsetTop(element) {
        var offsetTop = 0;

        while (element) {
          offsetTop += element.offsetTop;
          element = element.offsetParent;
        }

        return offsetTop;
      };

      var navBand = document.querySelector('.band--navigation');
      var navBandHeight = navBand.offsetHeight;
      var scrolltoPosition;

      if (navBand) {
        scrolltoPosition = getOffsetTop(currentAccordion) - (navBandHeight + 30);
      } else {
        scrolltoPosition = getOffsetTop(currentAccordion);
      }

      console.log(scrolltoPosition);
      window.scroll({
        top: scrolltoPosition,
        left: 0,
        behavior: 'smooth'
      });
    }, 250);
  }
}

function locationToggle(location) {
  var locations = document.querySelectorAll('[data-location]');
  var accordionItems = document.querySelectorAll('[data-accordion-item]');
  var currentLocation = document.querySelector('.js-gototarget[data-location="' + location + '"]');
  var currentAccordion = currentLocation.closest('[data-accordion-item]');
  var i;

  if (locations) {
    for (i = 0; i < locations.length; i++) {
      locations[i].classList.remove('active');
    }
  }

  if (accordionItems) {
    for (i = 0; i < accordionItems.length; i++) {
      accordionItems[i].querySelector('input').checked = false;
    }
  }

  if (currentLocation) {
    if (currentAccordion) {
      currentAccordion.querySelector('input').checked = true;
    }

    currentLocation.classList.add('active');
  }
}

(function () {
  var gotoLink = document.querySelectorAll('.js-gotolink');

  if (gotoLink) {
    for (var i = 0; i < gotoLink.length; i++) {
      gotoLink[i].addEventListener('click', function (e) {
        locationToggle(this.dataset.location);
        scrolltoToggle(this.dataset.location);
        e.preventDefault();
      });
    }
  }
})();

function clearLightbox() {
  var lightboxInner = document.querySelector('.lightbox__inner');
  lightboxInner.innerHTML = "";
}

function loadLightbox(url) {
  var lightboxInner = document.querySelector('.lightbox__inner');
  fetch(url).then(function (response) {
    return response.text();
  }).then(function (html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var lightboxcontent = doc.querySelector('.lightbox-content');
    lightboxInner.innerHTML = lightboxcontent.outerHTML;
  }).catch(function (err) {
    console.warn('Something went wrong.', err);
  });
}

(function () {
  var lightbox = document.querySelector('.lightbox');
  var closeLightbox = document.querySelectorAll('.js-closelightbox');
  var openLightbox = document.querySelectorAll('.js-openlightbox');
  var i;

  if (lightbox) {
    if (closeLightbox) {
      for (i = 0; i < closeLightbox.length; i++) {
        closeLightbox[i].addEventListener('click', function (e) {
          document.body.classList.remove('body--showLightbox');
          clearLightbox();
          e.preventDefault();
        });
      }
    }

    if (openLightbox) {
      for (i = 0; i < openLightbox.length; i++) {
        openLightbox[i].addEventListener('click', function (e) {
          if (this.dataset.lightbox) {
            loadLightbox(this.dataset.lightbox);
            document.body.classList.add('body--showLightbox');
            e.preventDefault();
          }
        });
      }
    }
  }
})();