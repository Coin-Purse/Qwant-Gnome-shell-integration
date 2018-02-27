// create atom project opener
// view log: journalctl /usr/bin/gnome-session -f -o cat

const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gio = imports.gi.Gio;
const Tweener = imports.ui.tweener;
const Params = imports.misc.params;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Soup = imports.gi.Soup;

const Gettext = imports.gettext;

Gettext.textdomain("Qwant_search@alex.nitters.eu");
Gettext.bindtextdomain("Qwant_search@alex.nitters.eu", Me.path + "/locale");

const _ = Gettext.gettext;

let qwantSearchProvider = null;

const searchUrl = "https://www.qwant.com/?q=";
const suggestionsUrl = "https://api.qwant.com/api/suggest";
const qwantLocale = _("locale");
const _httpSession = new Soup.Session();

let button;
let baseGIcon;
let hoverGIcon;
let buttonIcon;

let debug = false;

function logDebug() {
  if (debug) {
    log.apply(
      this,
      Array.from(arguments)
    )
  }
}

function makeResult(name, description, icon, id) {
  return {
    'id': id,
    'name': name,
    'description': description,
    'icon': icon
  }
}

function makeLaunchContext(params) {
  params = Params.parse(params, {
    workspace: -1,
    timestamp: global.display.get_current_time_roundtrip()
  });

  let launchContext = global.create_app_launch_context(
    params.timestamp,
    params.workspace
  );

  return launchContext;
}

function countProperties(obj) {
  let count = 0;

  for(let prop in obj) {
    if(obj.hasOwnProperty(prop))
    ++count;
  }

  return count;
}

const QwantSearchProvider = new Lang.Class({
  Name: 'QwantSearchProvider',

  _init : function(title, categoryType) {
    this._categoryType = categoryType;
    this._title = title;
    this.id = 'qwant-search-' + title;
    this.appInfo = {
      get_name : function() {
        return _("Qwant Search");
      },
      get_icon : function() {
        return Gio.icon_new_for_string(
          Me.path + "/icons/qwant_logo.png"
        );
      },
      get_id : function() {
        return this.id;
      }
    };
    this.qwantResults = new Map();
  },

  _getResultSet: function(terms) {
    logDebug("getResultSet");
    let resultIds = Array.from(this.qwantResults.keys())


    logDebug("found " + resultIds.length + " results" );
    return resultIds;
  },

  getResultMetas: function(resultIds, callback) {
    logDebug("result metas for name: "+resultIds.join(" "));
    let metas = resultIds.map(id => this.getResultMeta(id));
    logDebug("metas: " + metas.join(" "));
    callback(metas);
  },

  getResultMeta: function(resultId) {
    let result = this.qwantResults.get(resultId);
    let name = result.name;
    let description = result.description;
    logDebug("result meta for name: "+result.name);
    logDebug("result meta: ", resultId);
    return {
      'id': resultId,
      'name': name,
      'description': description,
      'createIcon' : function(size) {}
    }
  },

  processTerms: function(terms, callback, cancellable) {
    this.qwantResults.clear();
    let joined = terms.join(" ");
    this.qwantResults.set(
      searchUrl + encodeURIComponent(joined) + "#",
      makeResult(_("first - prepend") + " \"" + joined + "\" "+ _("first - append"),
      " ",
      function() {},
      searchUrl + encodeURIComponent(joined) + "#")
    );
    logDebug("ProcessTerms: " + joined);
    logDebug("Search with: " + joined);
    this.getSuggestions(terms, callback)
  },

  getSuggestions: function(terms, callback) {
    let joined = terms.join(" ");
    let suggestions = {};
    let request = Soup.form_request_new_from_hash(
      'GET',
      suggestionsUrl,
      {'q':joined, 'lang': qwantLocale}
    );
    logDebug("getSuggestions: ")

    _httpSession.queue_message(request, Lang.bind(this,
      function (_httpSession, response) {
        if (response.status_code === 200) {
          let json = JSON.parse(response.response_body.data);
          let jsonItems = json.data.items;
          let jsonSpecial = json.data.special;
          logDebug("bodydata", response.response_body.data);
          let parsedItems = jsonItems
          .filter(suggestion => suggestion.value != joined)
          .map(suggestion => {
            if (suggestion.value.startsWith("&")) {
              return {
                type: "special",
                name: suggestion.value,
                description: suggestion.site_name, url:
                searchUrl + encodeURIComponent(suggestion.value)
              };
            }
            else {
              return {
                type: "suggestion",
                name: suggestion.value,
                url: searchUrl + encodeURIComponent(suggestion.value)
              };
            }
          });
          let parsedSpecial = jsonSpecial
          .filter(suggestion => suggestion.value != joined)
          .map(suggestion => (
            {
              type: "special",
              name: (suggestion.name + " (" + suggestion.type +")"),
              description: suggestion.description,
              url: searchUrl + encodeURIComponent(suggestion.name)
            }
          ));
          suggestions = parsedSpecial.concat(parsedItems);
          logDebug("Array: " + JSON.stringify(suggestions));
        }
        else {
          logDebug("No internet or request failed, cannot get suggestions");
          suggestions = [{
            type: "special",
            name: _("Error name"),
            description: _("Error description"),
            url: " "
          }];
          logDebug("Array: " + JSON.stringify(suggestions));
        }
        this.displaySuggestions(suggestions, callback, terms);

      })
    );



    /********************TODO: Get results from Qwant********************/

  },

  displaySuggestions: function(suggestions, callback, terms) {
    for (let i = 0; i < countProperties(suggestions); i++) {
      if (suggestions[i].type == "suggestion") {
        this.qwantResults.set(
          suggestions[i].url,
          makeResult(
            " ",
            suggestions[i].name,
            function () {},
            suggestions[i].url
          )
        );
      }
      if (suggestions[i].type == "special") {
        this.qwantResults.set(
          suggestions[i].url,
          makeResult(
            suggestions[i].name,
            suggestions[i].description,
            function () {},
            suggestions[i].url
          )
        );
      }
    }
    callback(this._getResultSet(terms));
  },

  activateResult: function(resultId, terms) {
    let result = this.qwantResults[resultId];
    logDebug("activateResult: " + resultId);
    let url = resultId;
    logDebug("url: " + url)
    Gio.app_info_launch_default_for_uri(
      url,
      makeLaunchContext({})
    );
  },

  launchSearch: function(result) {
    logDebug("launchSearch: " + result.name);
    Gio.app_info_launch_default_for_uri(
      "https://www.qwant.com/",
      makeLaunchContext({})
    );
  },

  getInitialResultSet: function(terms, callback, cancellable) {
    logDebug("SuggestionId: " + this.suggestionId);
    logDebug("getInitialResultSet: " + terms.join(" "));
    this.processTerms(terms, callback, cancellable);
  },

  filterResults: function(results, maxResults) {
    logDebug("filterResults", results, maxResults);
    return results.slice(0, maxResults);
    //return results;
  },

  getSubsearchResultSet: function(previousResults, terms, callback, cancellable) {
    logDebug("getSubSearchResultSet: " + terms.join(" "));
    this.processTerms(terms, callback, cancellable, );
  },


});

function _openQwant() {
  logDebug("Lauched Qwant from button");
  Gio.app_info_launch_default_for_uri(
    "https://www.qwant.com/",
    makeLaunchContext({})
  );
}

function init(extensionMeta) {
  button = new St.Bin({style_class: 'panel-button',
  reactive: true,
  can_focus: true,
  x_fill: true,
  y_fill: false,
  track_hover: true});
  baseGIcon = Gio.icon_new_for_string(
    Me.path + "/icons/system_status_icon.png"
  );
  hoverGIcon = Gio.icon_new_for_string(
    Me.path + "/icons/qwant_logo.png"
  );
  buttonIcon = new St.Icon({
    'gicon': Gio.icon_new_for_string(
      Me.path + "/icons/system_status_icon.png"
    ),
    'style_class': 'system-status-icon'
  });

  button.set_child(buttonIcon);
  button.connect(
    'button-press-event',
    Lang.bind(this, _openQwant)
  );
  button.connect(
    'enter-event',
    function() {
      _SetButtonIcon('hover');
    }
  );
  button.connect(
    'leave-event',
    function(){
      _SetButtonIcon('base');
    }
  );
}

function enable() {
  logDebug("enable Qwant search provider");
  if (!qwantSearchProvider) {
    logDebug("enable Qwant search provider");
    qwantSearchProvider = new QwantSearchProvider();
    Main.overview.viewSelector._searchResults._registerProvider(
      qwantSearchProvider
    );
  }
  Main.panel._rightBox.insert_child_at_index(button, 0);
}

function disable() {
  if (qwantSearchProvider) {
    logDebug("disenable Qwant search provider");
    Main.overview.viewSelector._searchResults._unregisterProvider(
      qwantSearchProvider
    );
    qwantSearchProvider = null;
  }
  Main.panel._rightBox.remove_child(button);
}

function _SetButtonIcon(mode) {
  if (mode === 'hover') {
    buttonIcon.set_gicon(hoverGIcon);
  } else {
    buttonIcon.set_gicon(baseGIcon);
  }
}
