const MIXPANEL_DEBUG = false;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ANONYMOUS_USER_ID_KEY = "qabytes_analytics_anonymous_user_id";
const LAST_SEEN_AT_KEY = "qabytes_analytics_last_seen_at";

(function initializeAnalytics(root) {
  function getStorage() {
    try {
      return root.localStorage;
    } catch (error) {
      return null;
    }
  }

  function createUuid() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }

    return `qabytes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getOrCreateAnonymousUserId(storage) {
    if (!storage) {
      return createUuid();
    }

    const existing = storage.getItem(ANONYMOUS_USER_ID_KEY);
    if (existing) {
      return existing;
    }

    const nextId = createUuid();
    storage.setItem(ANONYMOUS_USER_ID_KEY, nextId);
    return nextId;
  }

  function parseTimestamp(value) {
    if (!value) {
      return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getEntryType() {
    const referrer = root.document.referrer || "";

    if (!referrer) {
      return "direct";
    }

    try {
      const referrerUrl = new URL(referrer);
      const currentHost = root.location.hostname;

      if (referrerUrl.hostname === currentHost) {
        return "internal";
      }

      if (/google|bing|duckduckgo|yahoo/i.test(referrerUrl.hostname)) {
        return "search";
      }

      if (/twitter|x\.com|linkedin|facebook|reddit|news\.ycombinator/i.test(referrerUrl.hostname)) {
        return "social";
      }

      return "referral";
    } catch (error) {
      return "unknown";
    }
  }

  function getDaysSince(lastSeenAtMs, currentSeenAtMs) {
    if (!lastSeenAtMs || !currentSeenAtMs || currentSeenAtMs <= lastSeenAtMs) {
      return null;
    }

    return Math.floor((currentSeenAtMs - lastSeenAtMs) / (24 * 60 * 60 * 1000));
  }

  const storage = getStorage();
  const anonymousUserId = getOrCreateAnonymousUserId(storage);
  const sessionId = createUuid();
  const sessionStartAtMs = Date.now();
  const lastSeenAtMs = parseTimestamp(storage && storage.getItem(LAST_SEEN_AT_KEY));
  const isReturningUser =
    Number.isFinite(lastSeenAtMs) && sessionStartAtMs - lastSeenAtMs <= SESSION_TIMEOUT_MS
      ? true
      : Boolean(lastSeenAtMs);
  const daysSinceLastSeen = getDaysSince(lastSeenAtMs, sessionStartAtMs);

  if (storage) {
    storage.setItem(LAST_SEEN_AT_KEY, new Date(sessionStartAtMs).toISOString());
  }

  let isMixpanelEnabled = false;
  let siteVersion = "unknown";
  let feedVersion = "";

  function getCommonProperties() {
    return {
      anonymous_user_id: anonymousUserId,
      session_id: sessionId,
      page_path: root.location.pathname,
      page_url: root.location.href,
      referrer: root.document.referrer || "",
      site_version: siteVersion,
      feed_version: feedVersion || "",
    };
  }

  function track(eventName, properties) {
    if (!root.mixpanel || typeof root.mixpanel.track !== "function") {
      return;
    }

    root.mixpanel.track(eventName, {
      ...getCommonProperties(),
      ...properties,
    });
  }

  function connectMixpanel() {
    if (!root.mixpanel || typeof root.mixpanel.track !== "function") {
      return;
    }

    if (typeof root.mixpanel.identify === "function") {
      root.mixpanel.identify(anonymousUserId);
    }

    root.mixpanel.register({
      distinct_id: anonymousUserId,
      anonymous_user_id: anonymousUserId,
      session_id: sessionId,
    });

    if (typeof root.mixpanel.set_config === "function") {
      root.mixpanel.set_config({
        debug: MIXPANEL_DEBUG,
        track_pageview: false,
        persistence: "localStorage",
      });
    }

    isMixpanelEnabled = true;
  }

  root.QABytesAnalytics = {
    init({ nextSiteVersion }) {
      siteVersion = nextSiteVersion || siteVersion;
      connectMixpanel();
    },
    setFeedVersion(nextFeedVersion) {
      feedVersion = nextFeedVersion || "";
      if (isMixpanelEnabled && root.mixpanel && typeof root.mixpanel.register === "function") {
        root.mixpanel.register({
          feed_version: feedVersion,
        });
      }
    },
    trackPageView(properties) {
      track("page_view", {
        entry_type: getEntryType(),
        ...properties,
      });
    },
    trackSessionStart(properties) {
      track("session_start", {
        is_returning_user: isReturningUser,
        days_since_last_seen: daysSinceLastSeen,
        ...properties,
      });
    },
    trackFeedLoaded(properties) {
      if (properties && properties.feed_generated_at) {
        this.setFeedVersion(properties.feed_generated_at);
      }

      track("feed_loaded", properties);
    },
    trackFilterSelected(properties) {
      track("filter_selected", properties);
    },
    trackArticleOpened(properties) {
      track("article_opened", properties);
    },
    trackArticleMarkedRead(properties) {
      track("article_marked_read", properties);
    },
    trackArticleSaved(properties) {
      track("article_saved", properties);
    },
    trackSavedPanelToggled(properties) {
      track("saved_panel_toggled", properties);
    },
    trackScrollDepthReached(properties) {
      track("scroll_depth_reached", properties);
    },
    trackSessionEnd(properties) {
      track("session_end", {
        session_duration_seconds: Math.round((Date.now() - sessionStartAtMs) / 1000),
        ...properties,
      });
    },
    isEnabled() {
      return isMixpanelEnabled;
    },
  };
})(globalThis);
