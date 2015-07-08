/** 
	Author: Jason Braswell
	Date created: 12/22/2014
	
	
	TO DO
	---------------------------------------------------
	 9- Export options + CSV export
	 8- Refresh rate
	 6- Class mapping
	 5- dt formatting
	 7- editability?
	 10- When going over 2 associations, in between associations will pull all data when attribute list is set to empty make it arbitrarily pick first attr in list
	 11 - tooltip
	 
	 POST-PRODUCTION
	 --------------------------------------------------------
	 - Cleanup / move certain functions to separate javascript files // use deferred/lists more
	 - Null checking / Error handling (for columns too)
	 - Remember paging?
	 - Support other tokens besides currentuser and currentobject in xpath
	 - Add error checking for search entity not matching last path object
	 - Allow wysiwyg exporting for microflow
	 
	 ADDT'L IDEAS
	 --------------------------------------------------------
	 Additional Widgets
	 - Add a subscribe/unsubscribe feature for listening widgets
	 1b- Linked Button
	 1a- Linked Data view
	 2?- Data source picker (Have it read the data sources and generate a button selector/dropdown with options depending on security?)
	 - allow forms or html snippets as templates for cell data
**/
mendix.dom.insertCss(mx.moduleUrl("DataGridUltimate.widget", "ui/dgu.css"));
mendix.dom.insertCss(mx.moduleUrl("DataGridUltimate.widget", "ui/dgu-jquery-ui.css"));
mendix.dom.insertCss(mx.moduleUrl("DataGridUltimate.widget", "ui/dgu-jquery-multiselect.css"));

require({
	packages:[
		{ name: "dgujquery", location: "../../widgets/DataGridUltimate/widget/lib", main: "jquery-min" },
		{ name: "dgujqueryui", location: "../../widgets/DataGridUltimate/widget/lib", main: "jquery-ui-min" }
	]},
[
	'dojo/_base/declare', 'mxui/widget/_WidgetBase', 
	"dijit/Menu", "dojo/Deferred", "dojo/DeferredList", "dijit/MenuItem", "dijit/CheckedMenuItem", "dijit/MenuSeparator", "dijit/PopupMenuItem"
	,"DataGridUltimate/widget/lib/jquery-ui-min"// The UI pkg will load the jquery version we want
], function (declare, _WidgetBase, Menu, Deferred, DeferredList, MenuItem, CheckedMenuItem, MenuSeparator, PopupMenuItem) {

// Load jQuery widgets
require(["DataGridUltimate/widget/lib/jquery-multiselect-min", "DataGridUltimate/widget/lib/jquery-colResizable-min"], function () {

	// Store my version of jQuery
	var _$ = $.noConflict(true), _jQuery = _$;

	return (function ($, jQuery) {
		return declare("DataGridUltimate.widget.DataGridUltimate", [_WidgetBase], {
		mixins : [mxui.mixin._Contextable],
		inputargs  : {
			entity: '',
			dataSources: null,
			
			refreshRate : 0,
			selectionType: 'single',
			selectFirst: true,
			loadingMsg: '',
			loadingImg: '',
			
			defaultRows: 20,
			topPaging: 'yes',
			bottomPaging: 'yes',
			showCount : true,
			pagingOptions: null,
			
			ctrlBarClickType: 'dblclick',
			controlBarButtons: null, // Added 'widget' property

			searchBtnType: 'initialClosed',
			searchWait: true,
			searchFields: null,
			/**
				Added properties:
				domNode : the dom node of the actual select or text box
				nullBox : the input node of the null box if allowNull is set
			**/
			searchBtnCaption : 'Search',
			searchBtnIcon : '',
			searchBtnClass : '',
			
			cacheColumns: true,
			columns: null,
			/** 
				Added properties:
				visible : (based on user role)
				hidden 	: (whether or not the column is actually visible)
				position : the changed position of the column
				header : the table header for the column
				checkMenu : Check menu item under columns context menu list (to toggle visibility)
			**/
			
			sortOrder: null,
			classMappingRules: null
		},

		context: null,
		contextObj : null,
		_handle : null,
		tableBody : null,
		currentDataSource : null,
		
		attributeList : null, 
		attributeMetaData : null, // Contains column links to items in attributes list
		referenceList : null,
		sortOrderList : null,
		
		count : 0,
		pageSize : 0,
		currentPage : 0,
		dataPending : false,
		
		table : null,
		controlBar : null,
		defaultBtn : null,
		
		searchPane : null,
		searchIsVisible : false,
		searchBtn : null,
		
		searchResultsPending : 0,
		searchDefaultsPending : 0,
		searchDataRetrieved : false,
		searchDefaultsRetrieved : false,
		_hasDefaultSearchValues : false,
		
		_selectAll : false,
		_rowData : null,
		_guids : null,
		_lastSearch : null,
		_selectedGuids : null, // If select all is enabled - this works as the deselected list
		_loadingScreen : null,
		_overlay : null,
		_paging : null,
		_noResultsPane : null,
		
		_checksum : null,
		_autoSave : true,
		_lastColClicked : null,
		_lastSortedColumns : null,
		_lastColumnWidths : null,
		
		_enumCache : null,
		
		constructor: function () {
			this._lastColumnWidths = [];	
			this._selectedGuids = [];
			this._guids = [];
			this._rowData = [];
			this._lastSearch = {};
			this._lastSortedColumns = [];
			this._paging = {};
			
			this.attributeList = [];
			this.attributeMetaData = [];
			this.referenceList = {};
			this.sortOrderList = [];
		},
		
		postCreate : function(){	
			var f;

			if (this.cacheColumns) {
				this._initalizeColumnSettings();
			}

			// Add in checks here
			if (this.selectFirst && this.selectionType == "none") {
				console.warn("'Select first' cannot be selected if selection mode is 'No selection'.");
				return;
			}

			this.pageSize = this.defaultRows;
			dojo.place(this.createGrid(), this.domNode);
			this._makeColumnsSortable();
			this._setColumnResizable(true);
			
			// Set this._hasDefaultSearchValues - invalid attr have been set by this point
			for (f in this.searchFields) { 
				if (!this.searchFields[f].invalid && (this.searchFields[f].searchDefaultMf || this.searchFields[f].searchDefault)) { 
					this._hasDefaultSearchValues = true;
					break;
				}
			}
			
			this.setDataLists();
			// TODO: Setup enum cache w/ the guessing game, or just make it basic options on the column?
			this._setupEnumCache();
			this.actLoaded();
		},
		
		update : function(contextObj, callback) {
			if (contextObj && contextObj.getGUID()) {
				// If we already have the context, only update when context has changed
				if (!this.contextObj || this.contextObj.getGUID() !== contextObj.getGUID()) {
					if (this._handle) { mx.data.unsubscribe(this._handle); }
					this.contextObj = contextObj;
					this.context = contextObj.getGUID();
					this._handle = this.subscribe({ guid : contextObj.getGUID(), callback : dojo.hitch(this, this.updateGrid)});
					this.updateGrid();
				}
			} else {
				console.warn("No data context received for DGU.");
			}
			
			if(callback){callback();}
		},
		
		updateGrid : function (guid) {
			var d = new dojo.Deferred();
			this.updateDataSource(); // This should go first
			this.searchDataRetrieved = false;
			this.searchDefaultsRetrieved = false;
			
			// Execute updating in this order
			d.then(dojo.hitch(this, this.updateSearchBarOptions))
			 .then(dojo.hitch(this, this.search))
			 .then(dojo.hitch(this, this.updateControlBar));
			d.resolve();
			this.currentPage = 0; // Reset the page if the data queried under new context
		},
		
		/// Columns have been initialized
		_setupEnumCache : function () {
			var i, c, m, self = this;

			/// Calls a java action to determine the image being used for each enum
			function updateCache (entity, attribute) {
				mx.data.create({
					entity : "DataGridUltimate.Argument",
					callback : dojo.hitch(self, function (obj) {
						var _self = self;
						obj.set("JSON", entity + "." + attribute);
						mx.data.action({
							params : {
								actionname : "DataGridUltimate.GetEnumImageData",
								applyto : "selection",
								guids : [obj.getGuid()]
							},
							callback : (function (_entity, _attr) {
								return function(jsonArray){
									var j, k, cache, 
									enums = $.parseJSON(jsonArray);
									cache = _self._enumCache[entity][attribute];
									
									var findImgFile = function (cacheSetting) {
										return function () {
											var img = cacheSetting.image;
											var handle = function (response, status) {
												if (status.xhr.status == 200) {
													cacheSetting.image = status.args.url;
													// console.log(cacheSetting);
												}
											};
											dojo.xhrGet({
												url : '..\\img\\' + img + '.png',
												failOk : true,
												handle : handle
											});
											dojo.xhrGet({
												url : '..\\img\\' + img + '.jpg',
												failOk : true,
												handle : handle
											});
											dojo.xhrGet({
												url : '..\\img\\' + img + '.gif',
												failOk : true,
												handle : handle
											});
											
											/*var checks = new dojo.DeferredList([pngCheck, jpgCheck, gifCheck]);*/
										};
									};
									
									/// Set image url
									for (j in enums) {
										for (k in cache) {
											if (cache[k].key === enums[j].value) {
												cache[k].image = enums[j].image.replace(/\.Images\./gi, "$");
												findImgFile(cache[k])();
												break;
											}
										}
									}
								};
							}(entity, attribute))
						});
					})
				});
			}
			
			this._enumCache = {};

			// Set up enum lists
			for (i = 0; i < this.columns.length; i++) {
				c = this.columns[i];
				if (!c.hidden && c.colDataType === 'field' && c.colEnumDisplay !== 'value') {
					m = mx.meta.getEntity(c.colEntity);
					if (m.isEnum(c.colAttr)) {
						if (!this._enumCache[c.colEntity]) { this._enumCache[c.colEntity] = {}; }
						if (!this._enumCache[c.colEntity][c.colAttr]) {
							this._enumCache[c.colEntity][c.colAttr] = m.getEnumMap(c.colAttr);
							// TODO: Set enum image
							// updateCache(c.colEntity, c.colAttr);
						}
					}
				}
			}
			
		},
		
		_initalizeColumnSettings : function () {
			var i, temp = [], min = 1, max = -1, reinit = false, reinitialize = true,
				settings, settingsList, 
				oldSettingsHash, visibleFlags, position;
				
			if (Storage === 'undefined') {
				console.warn('Browser does not support local storage. Cached preferences not saved.');
				return;
			}
			
			this._checksum = this.HashObject(this.columns, ["visible", "hidden", "position"]);
			
			// Get the current settings stored in the browser
			settings = localStorage.getItem('dgu-' + this.mxid);
			
			// Get settings
			if (settings) {
				settingsList = settings.split(";");
				oldSettingsHash = settingsList[0] || [];
				visibleFlags = settingsList[1] || [];
				
				if (settingsList[2]) {
					position = settingsList[2].split(',');
				}
			}
			
			// If nothing has changed, set the values
			if (oldSettingsHash && oldSettingsHash == this._checksum) {
				reinit = false;
				reinitialize = false;
				
				// Sanity check (dupes)
				for (i = 0; i < position.length; i++) {
					if (temp[position[i]]) {
						reinit = true;
						break;
					}
					
					temp[position[i]] = true;
					if (position[i] > max) { max = position[i]; }
					if (position[i] < min) { min = position[i]; }
				}
				
				// Sanity check (length and range)
				if (reinit || 
					position.length !== this.columns.length || max != position.length-1 || min != 0) {
						console.warn("There was an issue loading the saved data for this data grid.");
						reinitialize = true;
				}
			}

			if (reinitialize) {
				for (i = 0; i < this.columns.length; i++) {
					this.columns[i].hidden = false;
					this.columns[i].position = i;
				}
				this._updateColumnSettings();
			} else {
				for (i = 0; i < this.columns.length; i++) {
					this.columns[i].hidden = (visibleFlags.charAt(i) === '0');
					this.columns[i].position = position ? parseInt(position[i], 10) : i;
				}
			}
			
		},
		
		_updateColumnSettings : function () {
			var i, 
				key = 'dgu-' + this.mxid, value,
				visibleFlags = '', position = [];
			
			if (Storage === 'undefined') {
				console.warn('Browser does not support local storage. Cached preferences not saved.');
				return;
			}
			
			for (i = 0; i < this.columns.length; i++) {
				visibleFlags += this.columns[i].hidden ? "0" : "1";
				if (this.columns[i].hasOwnProperty("position")) {
					position[i] = this.columns[i].position;
				} else {
					position[i] = i;
				}
			}
			
			value = [this._checksum, visibleFlags, position.join(',')];
			
			localStorage.setItem(key, value.join(';'));
		},
		
		_setColumnVisibility : function (column, visible) {
			var i, canHide = false, display = visible ? '' : 'none';
			
			if (!visible) {
				for (i in this.columns) {
					if (this.columns[i].visible && !this.columns[i].hidden
						&& this.columns[i] !== column) {
							canHide = true;
							break;
						}
				}
				
				if (!canHide) {
					mx.ui.warning("Must have at least one column visible.", true);
					return;
				}
			}
			
			column.checkMenu.set('checked', visible);
			column.hidden = !visible;
			
			// Hide/Show header
			dojo.style(column.header, "display", display);
			
			// Hide/Show data in each row
			for (i in this._rowData) {
				dojo.style(this._rowData[i].children[column.position], 'display', display);
			}
			
			// Hide/Show the col
			// dojo.style($(this.domNode).find('col')[column.position], 'display', display);
			
			if (this._autoSave) {this._updateColumnSettings();}
			
			// Refresh column resizing
			this._setColumnResizable(false);
			this._setColumnResizable(true);
		},
		
		_moveColumn : function (column, toIndex, autoSave) {
			var i, currentPos = column.position, 
			start, end, shift, countItself = 0,
			colgroup, col;
			
			// Shift the position of everything
			if (toIndex > currentPos) { 
				shift = -1;
				start = currentPos + 1;
				end = toIndex;
				countItself = 1;
			} else if (toIndex < currentPos) {
				shift = 1;
				start = toIndex;
				end = currentPos - 1;
			} else {
				return;
			}
			
			// Move the data over to the right position
			for (i = 0; i < this._rowData.length; i++) {
				dojo.place(this._rowData[i].children[currentPos], this._rowData[i], toIndex + countItself);
			}
			
			// Move the col in the colgroup
			colgroup = $(this.domNode).find("colgroup").get(0);
			col = colgroup.children[currentPos];
			dojo.place(col, colgroup, toIndex + countItself);
			
			// Update position
			for (i = 0; i < this.columns.length; i++) {
				if (this.columns[i].position >= start && this.columns[i].position <= end) {
					this.columns[i].position += shift;
				}
			}
			
			column.position = toIndex;
			if (autoSave) { this._updateColumnSettings();}
			
			// Refresh column resizing
			this._setColumnResizable(false);
			this._setColumnResizable(true);
		},
		
		_restoreDefaults : function () {
			var i, j, pos;
			
			// Move the column headers
			for (i = 0; i < this.columns.length; i++) {
				dojo.place(this.columns[i].header, this.columns[i].header.parentNode, "last");
			}
			
			// Move the columns
			for (i = 0; i < this.columns.length; i++) {
				this._moveColumn(this.columns[i], i, false);
			}
			
			// Show everything (data)
			for (i in this.columns) {
				if (this.columns[i].hidden) {
					pos = this.columns[i].position;
					for (j in this._rowData) {
						dojo.style(this._rowData[j].children[pos], 'display', '');
					}
				}
			}
			
			for (i in this.columns) {
				if (this.columns[i].hidden) {
					this.columns[i].hidden = false;
					dojo.style(this.columns[i].header, 'display', '');
					this.columns[i].checkMenu.set('checked', true);
				}
			}
			
			// Show cols
			// $(this.domNode).find('col').show();
			
			if (this._autoSave) {this._updateColumnSettings();}
			
			// Refresh column resizing
			this._setColumnResizable(false);
			this._setColumnResizable(true);
		},
		
		generateHeaderCtxMenu : function (headerNodes) {
			var i, child, self = this,
				menu = new dijit.Menu({
					targetNodeIds : headerNodes
				})
				
				,restore = new dijit.MenuItem({
					label: "Restore defaults",
					iconClass : "glyphicon glyphicon-refresh",
					onClick : dojo.hitch(this, this._restoreDefaults)
				})
				
				,autosave = new dijit.CheckedMenuItem({
					label: "Auto save",
					checked : true,
					onClick : dojo.hitch(this, function () {
						this._autoSave = !this._autoSave;
					})
				})
				
				,hide = new dijit.MenuItem({
					label: "Hide column",
					iconClass : "glyphicon glyphicon-eye-close",
					onClick : dojo.hitch(this, function (e) {
						this._setColumnVisibility(this._lastColClicked, false);
					})
				})
				
				,colSubMenu = new dijit.Menu()
				
				,cols = new dijit.PopupMenuItem({
					label: "Columns"
					,popup: colSubMenu,
					iconClass : "glyphicon glyphicon-list"
				}),
				
				orderedColumns = this.columns.slice(0)
			;

			orderedColumns.sort(function (a, b) {
				var c = a.colName.toLowerCase(),
					d = b.colName.toLowerCase();
				if (c > d) {return 1;}
				if (d > c) {return -1;}
				return 0;
			});
			
			// Add columns to list
			for (i = 0; i < orderedColumns.length; i++) {		
				if (orderedColumns[i].visible) {
					child = new dijit.CheckedMenuItem({
						label : orderedColumns[i].colName,
						checked : !orderedColumns[i].hidden,
						disabled : !orderedColumns[i].colHideable // Disable per config
					});
					
					orderedColumns[i].checkMenu = child;
					dojo.addClass(child.domNode, 'dgu-h-ctxMenuItem');
					dojo.addClass(child.domNode.children[1], 'dgu-h-ctxMenuItemLabel');
					
					// Need to manually attach click event to prevent future propagation (hiding the menu)
					if (orderedColumns[i].colHideable) {
						dojo.connect(child.domNode, 'click', dojo.hitch(this, 
							(function (c) {
								return function (e) {
									this._setColumnVisibility(c, !c.checkMenu.checked);
									e.stopPropagation();
									e.preventDefault();
									return false;
								};
							}(orderedColumns[i]))
						));
					}
					
					colSubMenu.addChild(child);
				}
			}
			
			// Create menu
			menu.addChild(restore); dojo.addClass(restore.domNode, 'dgu-h-ctxMenuItem');
			menu.addChild(autosave); dojo.addClass(autosave.domNode, 'dgu-h-ctxMenuItem');
			menu.addChild(hide); dojo.addClass(hide.domNode, 'dgu-h-ctxMenuItem');
			menu.addChild(cols); dojo.addClass(cols.domNode, 'dgu-h-ctxMenuItem');
			
			dojo.addClass(colSubMenu.domNode, 'dgu-h-ctxMenu');
			dojo.addClass(menu.domNode, 'dgu-h-ctxMenu');
			dojo.connect(menu , '_openMyself' , function (e) {
				var j;
				
				for (j = 0; j < self.columns.length; j++) {
					if (e.target === self.columns[j].header) {
						self._lastColClicked = self.columns[j];
						break;
					}
				}
				
				// Update 'Hide Column' visibility option
				this.getChildren()[2].set('disabled', 
					self._lastColClicked && !self._lastColClicked.colHideable);
				
			});
			menu.startup();
		},
		
		_makeColumnsSortable : function () {
			$(".dgu-table thead", this.domNode).sortable({
				items: "th:not(.dgu-frozen)",
				cancel : "th:not(.dgu-moveable)",
				cursor : "move",
				containment : "parent",
				delay : 150,
				helper: function(event, target) {
					var width = $(target[0]).width();
					var helper = $(target[0]).clone();
					helper.css({
						'width': width
					});
					helper.addClass("dgu-placeholder");
					return helper;
				},
				//tolerance : "pointer",
				zIndex: 1,
				update : dojo.hitch(this, function (event, ui) {
					var header = ui.item.context;
					var newPos = $(ui.item.context.parentNode.children).index(ui.item.context);
					var i;
					
					for (i = 0; i < this.columns.length; i++) {
						if (this.columns[i].header == header) {
							this._moveColumn(this.columns[i], newPos, true);
							break;
						}
					}
				})
			});
			
			$(".dgu-table th", this.domNode).disableSelection();
		},
		
		_setColumnResizable : function (enabled) {
			var c, i, cols = $(this.domNode).find("colgroup").get(0).children, 
				oldWidths = [];
			
			for (c in cols) { oldWidths.push(dojo.attr(cols[c], "width")); }
			
			if (this.table) {
				if (enabled) {
					$(this.table).colResizable({liveDrag : true, headerOnly : true });
				} else {
					$(this.table).colResizable({disable : true});
				}
				
				// Reset column widths
				for (i = 0; i < cols.length; i++) { dojo.attr(cols[i], 'width', oldWidths[i]); }
			} else {
				console.error("Table does not exist. Cannot enable resizing.");
			}
		},
		
		// Creates the DOM structure for this widget
		createGrid : function () {
			var container = dojo.create("div"),
				searchBar = this.createSearchBar(),
				controlBar = this.createControlBar();
			this.table = this.createTable();
			this._noResultsPane = this.createNoResultsPane();
			var paging = this.createBottomPaging();
			this._loadingScreen = this.createLoadingScreen();
			this._overlay = dojo.create("div");
			
			dojo.addClass(this._overlay, "dgu-overlay");
			dojo.addClass(container, "dgu-container");
			dojo.place(this._loadingScreen, container);
			dojo.place(this._overlay, container);
			if (searchBar) {dojo.place(searchBar, container);}
			dojo.place(controlBar, container);
			dojo.place(this.table, container);
			dojo.place(this._noResultsPane, container);
			if (paging) {dojo.place(paging, container);}
			
			return container;
		},
		
		createNoResultsPane : function () {
			var container = dojo.create("div");
			var warning = dojo.create("span");
			dojo.addClass(container, "dgu-no-results");
			dojo.addClass(warning, "dgu-no-results-warn glyphicon glyphicon-warning-sign");
			dojo.place(warning, container);
			dojo.place(document.createTextNode("No search results found."), container);
			return container;
		},
		
		// Creates the overlay and loading image for future use
		createLoadingScreen : function () {
			var screen = dojo.create("div");
			var img = dojo.create("img", { "src" : this.loadingImg});
			var text = dojo.create("span", { innerHTML : this.loadingMsg });
			dojo.place(img, screen);
			dojo.place(text, screen);
			
			dojo.addClass(screen, "dgu-loading");
		
			return screen;
		},
		
		// Creates DOM structure for search bar
		createSearchBar : function () {
			var i, nullCheck, nullLabel, updateNullBox, text, container, field, 
			label, select, multiselectOptions;
			
			if (this.searchBtnType == "never"){
				return null;
			}
			
			updateNullBox = function (f) {
				return function () {
					this._updateNullBox(f);
				};
			};
			
			this.searchPane = dojo.create("div");
			dojo.addClass(this.searchPane, ["dgu-search-bar", "group"]);
			
			// Set default visibility
			if (this.searchBtnType == "initialOpen" || this.searchBtnType == "always") {
				this.searchIsVisible = true;
			} else {
				dojo.style(this.searchPane, "display", "none");
			}
			
			// Add search controls
			dojo.place(this.createSearchControls(), this.searchPane);
			
			// Add search fields
			for (i = 0; i < this.searchFields.length; i++) {
				field = this.searchFields[i];
				
				if (this.isValid('all', field.searchUserRoles)) {
					field.isValid = true;
					container = dojo.create("div");
					label = dojo.create("label", { innerHTML: field.searchCaption});
					dojo.addClass(container, "dgu-search-box");
					dojo.place(label, container);
					
					// Text and Dates
					if (field.searchFieldType != "dropdown") {
						text = dojo.create("input", { "type" : "text"});
						dojo.addClass(text, "dgu-search-box-input");
						dojo.place(text, container);
						
						if (field.searchFieldType == "date") {
							dojo.attr(text, "placeholder", "mm/dd/yyyy");
							
							// No need to create datepicker widget if it can't be selected
							if (field.searchType == "normal") {
								$(text).datepicker();
							}
						}
						
						// Add event for Enter -> Search
						dojo.connect(text, "onkeypress", dojo.hitch(this, function (event) {
							if (event.keyCode == 13) {this.search(false);}
						}));
						
						field.domNode = text; // Store the association in memory
					} else { // Dropdown
						select = dojo.create("select");
						dojo.addClass(select, "dgu-search-box-select");
						dojo.place(select, container);
						
						// Don't bother creating the multi-select if it's read-only or hidden
						if (field.searchMulti && field.searchType == 'normal') {
							dojo.attr(select, "multiple", "multiple");
							
							multiselectOptions = { 
								noneSelectedText : "Please select",
								selectedText: function(numChecked, numTotal, checkedItems){
									return numChecked + ' of ' + numTotal + ' selected';
								},
								checkAllText : "Select all",
								uncheckAllText : "Deselect all"
							};
							
							$(select).multiselect(multiselectOptions);
						} else {
							dojo.place(dojo.create("option", {innerHTML: "Please select"}), select);
						}
							
						field.domNode = select; // Store the association in memory
					}
					
					// Null
					if (field.allowNull) {
						nullCheck = dojo.create("input", { "type" : "checkbox"});
						nullLabel = dojo.create("label", { innerHTML : "Empty" });
						dojo.addClass(nullLabel, "dgu-null-box");
						dojo.place(nullCheck, nullLabel, "first");
						dojo.place(nullLabel, container);
						dojo.connect(nullCheck, "onchange", dojo.hitch(this, updateNullBox(field)));
						field.nullBox = nullCheck;
						
						if (field.searchDefault.toLowerCase() === "(null)") {
							nullCheck.defaultChecked = true;
							nullCheck.checked = true;
							this._updateNullBox(field);
						}
					}
					
					// Set visibility
					if (field.searchType == 'hidden') {
						dojo.style(container, 'display', 'none');
					} else if (field.searchType == "readonly") {
						dojo.attr(field.domNode, 'disabled', 'true');
					}
					
					dojo.place(container, this.searchPane);
				} else {
					field.invalid = true;
				}
			}
			
			return this.searchPane;
		},
		
		// Update logic for relationship between null box and field
		_updateNullBox : function (field) {
			var disabled = field.nullBox.checked,
				difference = (field.domNode.disabled != disabled);
			
			if (difference) {
				field.domNode.disabled = field.nullBox.checked;
				
				if (field.searchMulti && field.searchType == 'normal') {
					$(field.domNode).multiselect(disabled ? 'disable' : 'enable');
				}
			}
		},
		
		// Add Search / Reset buttons
		createSearchControls : function () {
			var searchControls = dojo.create("div");
			dojo.addClass(searchControls, "dgu-search-controls");
			
			var searchBtn = new mxui.widget.Button({ 
				caption: "Search", 
				onClick : dojo.hitch(this, function () {
					this.currentPage = 0; // Reset the paging
					this.search(); //  Search
				})
			});
			dojo.addClass(searchBtn.domNode, "dgu-search-btn");
			dojo.place(searchBtn.domNode, searchControls);	
			
			var resetBtn = new mxui.widget.Button({ caption: "Reset", onClick : dojo.hitch(this, this.resetSearchFilters)});
			dojo.addClass(resetBtn.domNode, "dgu-reset-search-btn");
			dojo.place(resetBtn.domNode, searchControls);
			
			return searchControls;
		},
		
		// Updates data for search bar
		updateSearchBarOptions : function (callback) {
			if (!this.currentDataSource || this.currentDataSource.dataSrc !== "xpath") {
				if (callback) { callback(); }
				return;
			}
			
			this._updateSearchBarDefaultData(callback);
		},
		
		_updateSearchBarData : function (searchCallback) {
			var i, isAttr,
				fields, 
				filter,
				staticValues,
				searchEntity,
				self = this,
				onComplete = function () {
					if (self.searchResultsPending == 0) {
						self.searchDataRetrieved = true;
						self.updateLoadingScreen(); // Trigger removal of loading message
						if (searchCallback) {searchCallback();}
					}
				},
				callback = function (_field, _callback, _defaultsSet) {
					// Make sure the right scope is hitched...
					return function (objects) {
						this.updateSearchFieldOptions(_field, objects, _defaultsSet);
						this.searchResultsPending--;
						if (_callback) {_callback();}
					};
				},
				getStaticObj = function (attr, value, caption) {
					var obj = { get : function (attribute) { return this[attribute]; }};
					obj[attr] = value;
					obj["caption"] = caption;
					return obj;
				};
			
			// If we already have the data or the search isn't visible and we're allowed to wait,
			// then don't do quite anything yet...
			if (this.searchDataRetrieved || (!this.searchIsVisible && this.searchWait && !this._hasDefaultSearchValues)) { return; }

			fields = this.searchFields;
			
			// Note the # of async calls to make
			for (i = 0; i < fields.length; i++) {
				if (fields[i].searchFieldType === "dropdown" && !fields[i].invalid) {
					this.searchResultsPending++;
				}
			}
			
			if (this.searchResultsPending == 0) {
				onComplete();
				return;
			}
			
			this.updateLoadingScreen (); // Trigger loading message
			
			for (i = 0; i < fields.length; i++) {
				if (fields[i].searchFieldType == "dropdown" && !fields[i].invalid) {
					isAttr = true;
					searchEntity = fields[i].searchEntity;
									
					if (searchEntity != this.entity) {
						isAttr = false;
					}
					
					// Boolean values are static for attributes
					if (isAttr && mx.metadata.getEntity(searchEntity).isBoolean(fields[i].searchAttr)) {
						staticValues = [
							getStaticObj(fields[i].searchAttr, "true", "Yes"),
							getStaticObj(fields[i].searchAttr, "false", "No")
						];
						dojo.hitch(this, callback (fields[i], onComplete, this.defaultsSet))(staticValues);
					// Enum values are static for attributes
					} else if (isAttr && mx.metadata.getEntity(searchEntity).isEnum(fields[i].searchAttr)) {
						staticValues = [];
						
						mx.metadata.getEntity(searchEntity)
							.getEnumMap(fields[i].searchAttr)
							.forEach(function (m) {
								staticValues.push(getStaticObj(fields[i].searchAttr, m.key, m.caption));
							});

						dojo.hitch(this, callback (fields[i], onComplete, this.defaultsSet))(staticValues);
					// Either a non Bool/Enum Attr or an Association
					} else {
						filter = {
							attributes : [fields[i].searchAttr],
							distinct : true
						};
						
						if (fields[i].searchSort) {
							filter.sort = [[fields[i].searchSort, fields[i].searchSortType]];
						}

						mx.data.get({
							xpath : "//" + searchEntity + this.formatXPath(fields[i].searchConstraint, this.context),
							filter : filter,
							callback : dojo.hitch(this, callback(fields[i], onComplete, this.defaultsSet)),
							error : function (err) {
								console.error(err);
							}
						});
					}
				}
			}
			
			this.defaultsSet = true;
		},
		
		_updateSearchBarDefaultData : function (searchCallback) {
			var i, 
				self = this,
				fields,
				onComplete = (function (_searchCallback) {
					return function () {
						if (self.searchDefaultsPending == 0) {
							self.searchDefaultsRetrieved = true;
							self.updateLoadingScreen();
							self._updateSearchBarData(_searchCallback);
						}
					};
				}(searchCallback)),
				callback = function (_field, _callback) {
					// Make sure the right scope is hitched...
					return function (values) {
						_field.searchDefault = values;
						this.searchDefaultsPending--;
						if (_callback) {_callback();}
					};
				};
						
			if (!this.searchDefaultsRetrieved && (this.searchIsVisible || !this.searchWait || this._hasDefaultSearchValues)) {
				fields = this.searchFields;
				
				// Note the # of async calls to make
				for (i = 0; i < fields.length; i++) {
					if (fields[i].searchDefaultMf && !fields[i].invalid) {
						this.searchDefaultsPending++;
					}
				}
				
				this.updateLoadingScreen (); // Trigger loading message
				
				if (this.searchDefaultsPending == 0) {
					onComplete();
					return;
				}
				
				for (i = 0; i < fields.length; i++) {
					if (fields[i].searchDefaultMf && !fields[i].invalid) {
						mx.data.action({
							params : {
								actionname : fields[i].searchDefaultMf,
								applyto : "selection",
								guids : [this.context]
							},
							callback : dojo.hitch(this, callback(fields[i], onComplete)),
							error : function (err) {
								console.error(err);
							}
						});
					}
				}
			}
		
		},
		
		// Updates DOM for search bar
		updateSearchFieldOptions : function (field, objects, defaultsSet){
			var i, select = field.domNode, selection = [], value, selected, option;
			var hasEmptyOption = field.searchType != "normal" || !field.searchMulti ? 1 : 0;
			var defaults = field.searchDefault.trim().replace(/\s*,\s*/gi, ",").split(",");
			
			// Save current selection
			for (i = 0; i < select.length; i++) {
				if (select.options[i].selected) {
					selection.push(select.options[i].value);
				}
			}
			
			// Remove all options
			for (i = select.length - 1; i >= hasEmptyOption; i--) {
				select.remove(i);
			}
			
			// Keep already selected values selected after refreshing
			for (i = 0; i < objects.length; i++) {
				value = objects[i].get(field.searchAttr);
				selected = selection.indexOf(value) > -1;
				option = dojo.create("option", { 
					"value" : value,
					innerHTML : objects[i].caption || value
				});
				
				// Set defaults
				if (defaults.length > 0 && defaults.indexOf(value) > -1) {
					option.defaultSelected = true;
					if (!defaultsSet) { selected = true; }
				}
				
				option.selected = selected;
				select.add(option);
			}
			
			// Only will have multi-select widget if it's a normal field
			if (field.searchMulti && field.searchType == 'normal') {
				$(field.domNode).multiselect('refresh');
			}
		},

		// Gets new data
		search : function (keepSelection, pageTurn) {
			var source = this.currentDataSource;
			var callback, self = this, context;
			var onError = function (err) {
				self.domNode.innerHTML = err;
				self.dataPending = false;
				self.updateLoadingScreen();
				self.updatePaging();
			};
			var args = {};
			
			if (!source) {
				console.error("No found data source. Search aborted.");
				return;
			}

			this._guids = [];
			this._rowData = [];

			if (source.dataSrc == "xpath") {
				
				// Set callback for JSON returned from XPath (over MF)
				callback = (function (_keepSelection) {
					return function (json) {
						var data = JSON.parse(json);
						
						// Create objects from json
						var total = data.count || data.mxobjects.length;
						var metaData = mx.meta.getEntity(self.entity);
						var o, objects = [];
						
						for (o in data.mxobjects) {
							objects.push(new mendix.lib.MxObject({ json : data.mxobjects[o], meta : metaData}));
						}
						
						// Update table DOM
						self.updateTable(objects, { count : total } , _keepSelection);
						// Toggle no results pane
						dojo.style(self._noResultsPane, "display", total == 0 ? "" : "none");
					};
				}(keepSelection));
			
				if (!pageTurn) {
					args.entityName = this.entity;
					args.count = true;
					args.attributes = this.attributeList;
					args.references = this.referenceList;
					args.offset = this.currentPage * this.pageSize;
					args.amount = this.pageSize;
					args.sort = this.sortOrderList;
					args.xpath = "//" + this.entity + this.formatXPath(source.constraint, this.context) + this._getSearchFilterXPath();
				} else {
					args = this._lastSearch;
					args.offset = this.currentPage * this.pageSize;
					args.amount = this.pageSize;
					args.callback = callback;
				}

			} else {	
				// Set callback for objects returned from MF or Assoc
				callback = (function (_keepSelection) {
					return function (objects, countObj) {
						var total = countObj && countObj.count ? countObj.count : objects.length;
						// Update table DOM
						self.updateTable(objects, countObj, _keepSelection);
						// Toggle no results pane
						dojo.style(self._noResultsPane, "display", total == 0 ? "" : "none");
					};
				}(keepSelection));
			
				args.error = onError;
				
				if (!pageTurn) {
					args.count =  true;
					args.filter = {
						attributes : this.attributeList,
						references : this.referenceList,
						offset : this.currentPage * this.pageSize,
						amount : this.pageSize,
						sort : this.sortOrderList
					};
					args.callback = callback;
				} else {
					args = this._lastSearch;
					args.filter.offset = this.currentPage * this.pageSize;
					args.filter.amount = this.pageSize;
					args.callback = callback;
				}

				if (source.dataSrc == "assoc") {
					args.guid = this.context;
					args.path = this.entity + "/" + source.assoc.split("/")[0];
				} else if (source.dataSrc == "mf") {
					args.microflow = source.mf;
					context = new mendix.lib.MxContext();
					context.setTrackObject(this.contextObj);
					args.context = context;
				}
			}
			
			if (pageTurn || !this._compareObjects(args, this._lastSearch)) {
				this._lastSearch = args;
				this.dataPending = true;
				this.updateLoadingScreen();
				
				if (source.dataSrc === "xpath") {
					// Create an arguments entity
					mx.data.create({
						entity: "DataGridUltimate.Argument",
						callback: function(argObj) {
							argObj.set("JSON", JSON.stringify(args));
							mx.data.action({
								params: {
									actionname : "DataGridUltimate.GetDataByJSON",
									applyto : "selection",
									guids : [argObj.getGUID()]
								},
								callback : callback,
								error : onError
							});
					}});
				} else {
					mx.data.get(args, this);
				}
			}
		},

		_compareObjects : function (a, b) {
			var prop;
			
			if (!a || !b) {return false;}
			
			for (prop in a) {
				if (typeof a[prop] === "object") {
					if (!this._compareObjects(a[prop], b[prop])) {
						return false;
					}
				} else if (typeof a[prop] !== "function" && a[prop] != b[prop]) {
					return false;
				}
			}
				
			return true;
		},
		
		// Returns xpath from the search filters
		_getSearchFilterXPath : function () {
			var i, f, j, options, isRef,  attr, concat, op, searchXPath, xpath = "";
			
			// Local function to return value specific for xpath
			function getValue (field, value, incrementDate) {
				var entity = field.searchEntity.split("/");
				var metaEntity = mx.metadata.getEntity(entity[entity.length-1]);
				var d, dt, offset = 0;
				
				// Use boolean methods instead
				if (metaEntity.isBoolean(field.searchAttr)) {
					if (value.toLowerCase() == 'true') {	return 'true()';}	
					return 'false()';
				} 
				// Numbers
				if (
					metaEntity.isCurrency(field.searchAttr) ||
					metaEntity.isNumber(field.searchAttr)
				) {
					return value; 
				}
				// Dates
				if (metaEntity.isDate(field.searchAttr)) {
					d = field.domNode.value.split("/");
					dt = new Date(d[2], d[0]-1, d[1]);
					if (incrementDate) { dt = dojo.date.add(dt, "day", 1); }
					
					// By default, dates are localized, subtract the offset to get UTC
					if (!metaEntity.isLocalizedDate(field.searchAttr)) {
						// offset is in minutes -> convert to millis
						offset = dt.getTimezoneOffset() * 60 * 1000;
					}
					
					return dt.getTime() - offset;
				}
				// String values
				return "'" + value + "'";
			}
			
			for (i = 0; i < this.searchFields.length; i++) {
				f = this.searchFields[i];
				isRef = (this.entity !== f.searchEntity);
				
				// Ensure field is valid
				if (
					(f.searchFieldType !== 'text' && 
						(f.searchCompType === 'con' || f.searchCompType === 'sw')) ||
					(f.searchFieldType !== 'date' && f.searchCompType === 'range') ||
					(f.searchFieldType == 'dropdown'  && f.searchCompType !== 'eq')
				) {
					mx.ui.error("Invalid search operation for this type of field. [" + f.searchCaption + "]");
					console.error("Invalid search operation for this type of field. [" + f.searchCaption + "]");
					continue;
				} 
				
				if (f.isValid) {
					searchXPath = "";
					
					// Null check
					if (f.allowNull && f.nullBox.checked) {
						if (isRef) { // Association
							searchXPath = '[not(' + f.searchPath + ")]";
						} else { // Attribute
							searchXPath = '[' + f.searchAttr + " = empty]";
						}
					}	
					// Dropdowns (including multi-select)
					else if (f.searchFieldType === 'dropdown') {
						// IE fix
						options = $(f.domNode).find(":selected");
						
						// Option check
						if (options.length > 0 && options.get(0).value !== 'Please select') {
							
							// Generate xpath
							concat = '';
							
							// Assocation setup
							if (f.searchPath && f.searchPath.length > 2 && isRef) {
								searchXPath = f.searchPath.substring(0, f.searchPath.length-1);
							} else if (isRef) {
								console.error("No linking path from entity to search field.");
								continue;
							}
							
							// General setup
							searchXPath += "[";
													
							for (j = 0; j < options.length; j++) {
								searchXPath += concat + f.searchAttr + " = " + getValue(f, options.get(j).value);
								concat = " or ";
							}
							if (isRef) { searchXPath += "]"; }
							searchXPath += "]";
						}
					}
					// Textboxes (Dates and text)
					else if (f.domNode.value) {
						
						if (f.searchPath && f.searchPath.length > 2 && isRef) {
								attr = f.searchPath.substring(1, f.searchPath.length-1) + "/" + f.searchAttr;
						} else if (!isRef) {
								attr = f.searchAttr;
						} else {
							console.error("No linking path from entity to search field.");
							continue;
						}
						
						if (f.searchCompType === 'con') {
							searchXPath = '[contains(' + attr + ", " + getValue(f, f.domNode.value) + ")]";
						} else if (f.searchCompType === 'sq') {
							searchXPath = '[starts-with(' + attr + ", " + getValue(f, f.domNode.value) + ")]";
						} else {
							if (f.searchCompType === 'range') {
								searchXPath = '[' + attr + ' > ' + getValue(f, f.domNode.value) + 
								' and ' + attr + ' < ' + getValue(f, f.domNode.value, true) + ']';
							} else {
								if (f.searchCompType === 'gt') { op = '>'; }
								else if (f.searchCompType === 'gte') { op = '>='; }
								else if (f.searchCompType === 'lt') { op = '<'; }
								else if (f.searchCompType === 'lte') { op = '<='; }
								else if (f.searchCompType === 'eq') { op = '='; }
								else if (f.searchCompType === 'neq') { op = '!='; }
								searchXPath = '[' + attr + ' ' + op + ' ' + getValue(f, f.domNode.value) + ']';
							}
						}
					}
					
					xpath += searchXPath;
				}
			}
			
			console.log(xpath);
			return xpath;
		},
		
		resetSearchFilters : function () {
			var i, f;
			// Clear and set defaults
			for (i = 0; i < this.searchFields.length; i++) {
				f = this.searchFields[i];
				
				// Hidden / Readonly values don't need to be reset b/c they can't be changed
				if (f.searchType === 'normal') {
				
					// Update default value(s)
					this._setSearchFilterDefault(f);
					
					// Update null settings
					if (f.nullBox) {
						f.nullBox.checked = f.nullBox.defaultChecked;
						this._updateNullBox(f);
					}
					
					// Update multi-select
					if (f.searchFieldType === 'dropdown' && f.searchMulti) {
						$(f.domNode).multiselect('refresh');
					}
				}
			}
			
			this.currentPage = 0; // Reset the paging
			this.search(true); // Search on default parameters 
		},
		
		_setSearchFilterDefault : function (field) {
			var o, options;
			
			if (field.searchFieldType != 'dropdown') {
				field.domNode.value = field.searchDefault;
			} else {
				options = field.domNode.options;
					
				for (o in options) {
					options[o].selected = options[o].defaultSelected;
				}
			}
		},
		
		// Creates the DOM structure for the control bar
		createControlBar : function () {
			var paging;
			
			this.controlBar = dojo.create("div");
			dojo.addClass(this.controlBar, "dgu-control-bar");
			
			if (this.topPaging != 'no') {
				paging = this.createTopPaging();
				dojo.place(paging, this.controlBar);
			}
			
			// Create Search toggle button
			if (this.searchBtnType == 'initialOpen' || this.searchBtnType == 'initialClosed') {
				this.searchBtn = new mxui.widget.Button({ 
					caption: this.searchBtnCaption,
					iconClass: this.searchBtnClass,
					iconUrl: this.searchBtnIcon,
					onClick : dojo.hitch(this, 
						function () {
							if (this.currentDataSource && this.currentDataSource.dataSrc == "xpath") {
								var visible = this.searchIsVisible;
								this.searchIsVisible = !this.searchIsVisible;
							
								if (visible) {
									$(this.searchPane).slideUp();
								} else {
									$(this.searchPane).slideDown();
									this.updateSearchBarOptions();
								}
							}
						})
				});
				
				dojo.place(this.searchBtn.domNode, this.controlBar);
			}
			
			return this.controlBar;
		},
		
		// Updates the buttons on the control bar
		updateControlBar : function () {
			var i, cb, event, visible, btn;

			for (i = 0; i < this.controlBarButtons.length; i++) {
			
				cb = this.controlBarButtons[i]; 
				
				// Check visibility (always hide buttons in a no-selection)
				visible = this.selectionType !== "none" && 
					this.isValid(cb.cbBtnVisType, cb.cbBtnUserRoles, this.contextObj, cb.cbBtnVisAttr, cb.cbBtnVisValue);
				
				// Create the button if it doesn't exist
				if (!cb.exists) {
					btn = new mxui.widget.Button({
						caption : cb.cbBtnCaption,
						iconUrl : cb.cbBtnImage
					});
					
					// Set tooltip
					dojo.attr(btn.domNode, "title", cb.cbBtnTooltip || cb.cbBtnCaption);
					
					// Set the event
					event = 
						(function (_config) {
							return function () {
								if (_config.cbBtnType === "all") {
									this.selectAll(true);
								} else if (_config.cbBtnType === "pg") {
									this.selectAll();
								} else if (_config.cbBtnType === "des") {
									this.deselectAll();
								} else if (_config.cbBtnType === "mf") {
									this._executeControlBarMicroflow(_config);
								} else if (_config.cbBtnType === "excel" || _config.cbBtnType === "ff") {
									this._export(_config);
								} else {
									console.warn("This feature has not been implemented yet. Button Type: " + _config.cbBtnType);
								}
							};
						}(cb));
						
					dojo.connect(btn.domNode, "click", dojo.hitch(this, event));
						
					cb.exists = true;
					cb.widget = btn;
					dojo.place(btn.domNode, this.controlBar, "last");
				}
				
				// Hide / Show
				dojo.style(cb.widget.domNode, "display", visible ? "" : "none");
				
				// Valid configuration
				if (cb.cbBtnType==="mf") {
					if (this.ctrlBarClickType === "click" && this.selectionType !== "none") {
						console.warn("Selection mode must be 'None' if the default trigger is 'Single click'.");
					} else if (this.ctrlBarClickType === "dblclick" && this.selectionType === "none") {
						console.warn("A non-default button that operates on the selection cannot be used if the selection mode of the grid is 'No selection'.");
					} else if (visible && cb.cbDefault) {
						this.defaultBtn = cb;
					}
				}
				
			}
			
		},
		
		// Creates the DOM structure for the data table
		createTable : function () {
			var i, j, col, columns = [], attr;
			var fixedLength = true, length = 0;
			var sortContainer, sortIcon, isSorted;
			var table = dojo.create("table", {"cellspacing": "0", "cellpadding": "0"});
			var colgroup = dojo.create("colgroup");
			var header = dojo.create("thead");
			var headerRow = dojo.create("tr");
			this.tableBody = dojo.create("tbody");
			
			// Set positions
			for (i = 0; i < this.columns.length; i++) {
				columns[this.columns[i].position] = this.columns[i];
			}
			
			for (i = 0; i < columns.length; i++) {
				
				// Determine column visibility by security options
				columns[i].visible = !columns[i].colUserRoles || 
					mx.session.hasSomeRole(columns[i].colUserRoles);
				
				if (columns[i].visible) {
					dojo.place(dojo.create("col", { "width" : columns[i].colWidth}), colgroup);
				
					if (columns[i].colWidth.indexOf("auto") > -1 || columns[i].colWidth.indexOf("%") > -1) {
						fixedLength = false;
					} else {
						try {
							length += parseInt(columns[i].colWidth.substring(0, columns[i].colWidth.length-2), 10);
						} catch (ex){
							console.warn("An error occurred trying to parse to column length in pixels.");
						}
					}
					
					// Add header
					col = dojo.create("th", { 
						innerHTML : columns[i].colName, 
						style : "width : " + columns[i].colWidth + ";"
					});
					
					// Add sorting icon
					if (columns[i].colDataType === 'field') {
						isSorted = false;
						dojo.connect(col, "click", dojo.hitch(this, this._sortColumn));
						sortContainer = dojo.create("div");
						dojo.addClass(sortContainer, "mx-datagrid-sort-icon");
						this._lastSortedColumns.push(columns[i]);
						dojo.place(sortContainer, col);
						sortIcon = dojo.create("span"); 
						dojo.addClass(sortIcon, "mx-datagrid-sort-text");
						dojo.place(sortIcon, sortContainer);
						
						// Check if column is being sorted
						for (j = 0; j < this.sortOrder.length; j++) {
							
							if (this.entity === columns[i].colEntity) {
								attr = columns[i].colAttr;
							} else {
								attr = columns[i].colPath.substring(1, columns[i].colPath.length-1) + "/" + columns[i].colAttr;
							}
							
							if (this.sortOrder[j].colAttr === attr) {
								sortIcon.innerHTML = this.sortOrder[j].sortDirection == 'asc' ? '▲' : '▼';
								isSorted = true;
								break;
							}
						}
						
						// Hide if not
						if (!isSorted) {
							dojo.style(sortContainer, 'display', 'none');
						}
					}
					
					columns[i].header = col;
					if (columns[i].colMove) {dojo.addClass(col, "dgu-moveable");}
					if (columns[i].colFrozen) {dojo.addClass(col, "dgu-frozen");}
					if (columns[i].colSort) {dojo.addClass(col, "dgu-sortable");}
					if (columns[i].colHideable) {dojo.addClass(col, "dgu-hideable");}
					if (columns[i].hidden) {dojo.style(col, 'display', 'none');}
					
					dojo.place(col, headerRow);
				}
				
			}
			
			// Add styling
			dojo.addClass(table, "dgu-table");
			if (fixedLength) {
				dojo.style(table, {
					"width" : "auto",
					"max-width" : length + "px"
				});	
			}
			if (this.selectionType != "none") {dojo.addClass(table, "dgu-table-selectable");}
			
			dojo.addClass(headerRow, "dgu-col-header");
			dojo.addClass(this.tableBody, "dgu-table-body");
			
			dojo.place(colgroup, table);
			dojo.place(headerRow, header);
			dojo.place(header, table);
			dojo.place(this.tableBody, table);
			
			if (this.cacheColumns) {
				// Apply context menu
				this.generateHeaderCtxMenu(headerRow.children);
			}
			
			return table;
		},
		
		// Determines the data source
		updateDataSource : function () {
			var i, source = null, newSource = null, canSearch = false;
			
			for (i = 0; i < this.dataSources.length; i++) {
				source = this.dataSources[i];
				if (this.isValid(source.dataSrcVisType, source.dataSrcUserRole, 
					this.contextObj, source.dataSrcAttr, source.dataSrcAttrValue)) {
					newSource = source;
					break;
				}
			}
			
			if (newSource.dataSrc == "xpath") { canSearch = true;}
			
			// Update variables (continue showing search if still searchable)
			this.searchIsVisible = this.searchIsVisible && canSearch;
			
			// Update visibility
			if (!canSearch) {
				dojo.style(this.searchPane, "display", "none"); // Hide pane
				if (this.searchBtn) {
					dojo.style(this.searchBtn.domNode, "display", "none"); // Hide button
				}
			} else {
				if (this.searchBtnType === "always") {
					dojo.style(this.searchPane, "display", ""); // Show pane
				} else if (this.searchBtnType !== "never") {
					dojo.style(this.searchBtn.domNode, "display", ""); // Show button
				}
			}
			
			// Update if default data has been retrieved
			if (this.currentDataSource != newSource) {
				this.searchResultsPending = 0;
				this.searchDefaultsPending = 0;
				this.searchDataRetrieved = !canSearch;
				this.searchDefaultsRetrieved = !canSearch;
			}
			
			// Set the new data source
			this.currentDataSource = newSource;
		},
		
		// Updates DOM for the Table
		updateTable : function (objects, countObj, keepSelection) {
			var i, o, row, columns = [];
			this.count = countObj && countObj.count ? countObj.count : objects.length;
			dojo.empty(this.tableBody);
			
			// Sort columns O(n)
			for (i = 0; i < this.columns.length; i++) {
				columns[this.columns[i].position] = this.columns[i];
			}
			
			// Create rows
			for (o in objects) {
				this._guids.push(objects[o].getGuid());
				row = this.createRow(objects[o], o, columns);
				this._rowData.push(row);
				dojo.place(row, this.tableBody);
			}
			
			this.resetSelection(keepSelection);
			this.updatePaging();
			this.dataPending = false;
			this.updateLoadingScreen();
		},
		
		createRow : function (obj, rowNum, columns) {
			var row = dojo.create("tr"), data;
			var i, clickEvent, defaultClick, self = this;
			
			for (i = 0; i < columns.length; i++) {
				if (columns[i].visible) {
					data = this.createData(obj, columns[i]);
					dojo.place(data, row);
					if (columns[i].hidden) {
						dojo.style(data, 'display', 'none');
					}
				}
			}
			
			// Add default button event
			if (this.defaultBtn && this.defaultBtn.widget) {
				defaultClick = (function (_clickedRow) {
					return function (event) {
						if (self.defaultBtn && !self._selectAll) { // Cannot execute when select all is enabled
							self.select(self._rowData[_clickedRow], _clickedRow, true);
							self._clickDefaultBtn();
						}
					};
				}(rowNum));
				
				dojo.connect(row, this.ctrlBarClickType, defaultClick);
			}
			
			if (this.selectionType != "none") {
				// Add select event
				clickEvent = (function (_rowNum) {
					return function (event) {
						self.rowClick(event, _rowNum);
					};
				}(rowNum));
				
				dojo.connect(row, "click", clickEvent);
			}
			
			return row;
		},
		
		_clickDefaultBtn : function () {
			if (this.defaultBtn) {
				this._executeControlBarMicroflow(this.defaultBtn);
			}
		},
		
		createData : function (obj, col) {
			var append = "", i, reference, refSet = [obj], temp, guid, tempArray, assocDepth = 0, counter=0;
			var td = dojo.create("td");
			var text = "Loading..."; // Replace with Loading GIF
			var cache = this._enumCache;
			var objGUID = obj.getGUID();
			
			// OnClick function
			var executeMicroflow = function (_guid, _colConfig) {
				return function () {
					var runMicroflow = function () {
						var underlay, progress, callback;
					
						if (_colConfig.colBtnProgBarType == "block") {
							underlay = true;
							mx.ui.showUnderlay();
						}
					
						if (_colConfig.colBtnProgBarType != "none") {
							progress = mx.ui.showProgress(_colConfig.colBtnProgMsg);
						}
					
						callback = function () {
							if (progress) {mx.ui.hideProgress(progress);}
							if (underlay) {mx.ui.hideUnderlay();}
						};
						
						mx.data.action({
							params : {
								actionname: _colConfig.colBtnMf,
								applyto: "selection",
								guids : [_guid]
							}, 
							async : _colConfig.colBtnMfCallType === "async",
							callback : dojo.hitch(this, callback),
							error : function (err) {
								console.error(err);
							}
						}, this);
					};
					
					if (_colConfig.colBtnAsk) {
						mx.ui.confirmation({
							content: _colConfig.colBtnQuestion,
							proceed: _colConfig.colBtnProceed,
							cancel: _colConfig.colBtnCancel,
							handler: dojo.hitch(this, runMicroflow)
						});
					} else { runMicroflow(); }
				
				};
			};
			
			// Gets the display of any particular value in regards to its data type
			var getDisplayValue = function(v) {
				var enumObj, d, meta, displayValue = v;
				
				if (v == null) { return ""; }
				
				// Not a calculated field
				if (col.colAttr && col.colEntity) {
					// Get meta data
					meta = mx.meta.getEntity(col.colEntity);
					
					// If Enum
					if (meta.isEnum(col.colAttr)) {
						// Get caption or image
						if (col.colEnumDisplay !== 'value' && cache[col.colEntity] && cache[col.colEntity][col.colAttr]) {
							enumObj = $.grep(cache[col.colEntity][col.colAttr], function (e) {return e.key === v;});
							if (enumObj.length == 1) {
								if (col.colEnumDisplay === 'icon') {
									// displayValue = "<img src='" + enumObj[0].image + "' />";
								} else if (col.colEnumDisplay === 'caption') { // caption
									displayValue = enumObj[0].caption;
								}
							}
						}
					}
					// DT Format
					else if (meta.isDate(col.colAttr)) {
						d = new Date(v);
						displayValue = (d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear();
					 }
					 // Boolean Format
					 else if (meta.isBoolean(col.colAttr)) {
						displayValue = v ? 'Yes' : 'No';
					 }
				 }
				 
				return displayValue;
			};
			
			// Generates the Final Cell content, given the textual value
			var setCellData = function (_columnConfig, _td, _value) {
				var btn, content = null;
				
				if (_columnConfig.colType === 'button') {
					btn = new mxui.widget.Button({
						caption: _value,
						renderType: _columnConfig.colBtnRenderType,
						iconUrl: _columnConfig.colBtnImg,
						title: _columnConfig.colBtnTooltip,
						onClick: executeMicroflow(objGUID, _columnConfig)
					});
					
					dojo.addClass(btn.domNode, "btn-" + _columnConfig.colBtnStyle.toLowerCase());
					
					content = btn.domNode;
					
				} else {
					content = dojo.create("div");
					content.innerHTML = _value;
				}

				dojo.place(content, td);
			};
			
			if (col.colDataType == "static") {
				text = getDisplayValue(col.colDataText);
			} else if (col.colDataType == "field" && col.colEntity == this.entity) {
				text = obj.has(col.colAttr) ? getDisplayValue(obj.get(col.colAttr)) : "";
			} else if (col.colDataType == "field") {
				reference = col.colPath.substring(1, col.colPath.length-1).split("/");
				assocDepth = reference.length/2;
				
				// Get data N deep
				while (counter < assocDepth && refSet && refSet.length > 0) {
					tempArray = [];
										
					// Check if current reference is a set
					for (i = 0; i < refSet.length; i++) {
						temp = refSet[i].get(reference[counter*2]);
						
						// Association exists?
						if (temp && typeof temp === 'object' && !(temp instanceof Array)) {
							// Reference set
							if (!temp.objectType) {
								for (guid in refSet[i].get(reference[counter*2])) {
									tempArray.push(new mendix.lib.MxObject({ json : temp[guid], meta : mx.meta.getEntity(temp[guid].objectType) }));
								}
							// Reference
							} else {
								tempArray.push(new mendix.lib.MxObject({ json : temp, meta : mx.meta.getEntity(temp.objectType)}));
							}
						}
					}
					
					refSet = tempArray;
					counter++;
				}
				
				// Set text
				text = "";
				
				for (i = 0; refSet && i < refSet.length; i++) {
					text += append + getDisplayValue(refSet[i].get(col.colAttr));
					append = ";";
				}

			} else {
				mx.data.action({
					params : {
						actionname : col.colCalcMf,
						applyto : "selection",
						guids : [obj.getGuid()]
					},
					callback : (function (_config, _td) {
						return function (calculatedValue) { 
							setCellData(_config, _td, getDisplayValue(calculatedValue));	
						};
					}(col, td)),
					error : function (err) {
						console.error(err);
					}
				});
			}
			
			setCellData(col, td, text); 
			
			return td;
		},
		
		rowClick : function (event, rowNum) {
			var row = event.target.nodeName === "TD" ? event.target.parentNode : event.target.parentNode.parentNode;
			var guid = this._guids[rowNum];
			var selectedIndex = this._selectedGuids.indexOf(guid), isSelected = selectedIndex > -1;
			
			if (this._selectAll) {
				isSelected = !isSelected;
				selectedIndex = rowNum;
			}
			
			// Single
			if (this.selectionType == "single") {
				if (isSelected) {
					this.deselect(row, selectedIndex);
				} else {
					this.select(row, rowNum, true);
				}
			}
			// Single and Maintain
			else if (this.selectionType == "singleMaintain") {
				if (!isSelected) {
					this.select(row, rowNum, true);
				}
			}
			// Multi-select
			else if (this.selectionType == "multi") {
				if (this._selectAll) {
					if (isSelected) {
						this.deselect(row, selectedIndex, !event.ctrlKey);
					} else {
						this.select(row, rowNum);
					}
				}
				else {
					if (isSelected) {
						this.deselect(row, selectedIndex);
					} else {
						this.select(row, rowNum, !event.ctrlKey);
					}
				}
			}		
			// Simple Multi-select
			else if (this.selectionType =="simpleMulti") {
				if (isSelected) {
					this.deselect(row, selectedIndex);
				} else {
					this.select(row, rowNum);
				}
			}	
		},
		
		select : function (rowNode, rowIndex, deselectOthers) {
			var index;
			
			if (this.selectionType !== "none") {
				if (deselectOthers) {this.deselectAll(true);}
			
				if (!this._selectAll) {
					this._selectedGuids.push(this._guids[rowIndex]);
				} else {
					index = this._selectedGuids.indexOf(this._guids[rowIndex]);
					
					if (index > -1) {
						this._selectedGuids.splice(index, 1);
					}
				}
					
					
				dojo.addClass(rowNode, "dgu-selected");
			}
		},
		
		deselect : function (row, selectionIndex, selectOthers) {
			if (this.selectionType !== "none") {
				if (selectOthers) {this.selectAll(true);}
				
				if(this._selectAll) {
					this._selectedGuids.push(this._guids[selectionIndex]);
				} else {
					this._selectedGuids.splice(selectionIndex, 1);
				}
				dojo.removeClass(row, "dgu-selected");
			}
		},
		
		deselectAll : function (ignoreSelectionType) {
			var row, selectFirst;
			
			this._selectAll = false;
			
			if (this.selectionType !== "none") {
				if (this.selectFirst || this.selectionType == "singleMaintain") {
					selectFirst = true;
				}
				
				// Remove formatting
				for (row in this._rowData) {
					dojo.removeClass(this._rowData[row], "dgu-selected");
				}
				
				// Reset list
				this._selectedGuids = [];
				
				// Select first (if needed)
				if (!ignoreSelectionType && selectFirst && this._rowData.length > 0) {
					this.select(this._rowData[0], 0);
				}
			}
		},
		
		selectAll : function (selectAll) {
			var row;
			
			if (this.selectionType === "multi" || this.selectionType === "simpleMulti") {
				if (selectAll) {
					this._selectAll = true;
					this._selectedGuids = [];
				} else {
					this._selectedGuids = this._guids.slice(0);
				}
			
				for (row in this._rowData) {
					dojo.addClass(this._rowData[row], "dgu-selected");
				}
			}
		},
		
		resetSelection : function (keepSelection) {
			var index, g;
			
			if (!keepSelection) {
				this.deselectAll();
			}
			
			if (!this._selectAll) {
				// Highlight all those on selection list
				for (g in this._selectedGuids) {
					index = this._guids.indexOf(this._selectedGuids[g]);
					
					if (index > -1) {
						dojo.addClass(this._rowData[index], "dgu-selected");
					}
				}
			} else {
				// Highlight all but those on deselection list
				for (g in this._guids) {
					index = this._selectedGuids.indexOf(this._guids[g]);
					
					if (index == -1) {
						dojo.addClass(this._rowData[g], "dgu-selected");
					}
				}
			}
			
		},
		
		createTopPaging : function () {
			var top = this._paging["top"] = { 
				container : dojo.create("div"),
				buttons : this.createPagingButtons(),
				text : dojo.create("span")
			};
			
			dojo.place(top.buttons["first"], top.container);
			dojo.place(top.buttons["previous"], top.container);
			dojo.place(top.text, top.container);
			dojo.place(top.buttons["next"], top.container);
			dojo.place(top.buttons["last"], top.container);
			
			dojo.addClass(top.container, "dgu-top-paging");
			
			return top.container;
		},
		
		createBottomPaging : function () {
			var o, option, bottom = this._paging["bottom"] = { 
				container : dojo.create("div"),
				buttons : this.createPagingButtons(),
				text : this.showCount ? dojo.create("span") : null,
				input : dojo.create("input", { "type" : "text" }),
				postInput : dojo.create("label")
			};
			
			// On change event for input box
			dojo.connect(bottom.input, "onchange", dojo.hitch(this, function (event) {
				
				function revert (input, value) {
					input.value = value;
					mx.ui.warning("Invalid page number", true);
				}
				
				if (isNaN(event.target.value)) {
					revert(event.target, this.currentPage + 1);
					return;
				}
				
				var targetPage = event.target.value - 1;
				var pages = Math.ceil(this.count / this.pageSize) - 1;
				
				if (targetPage == this.currentPage) {
					return;
				}
				
				if (targetPage > pages || targetPage < 0) {
					revert(event.target, this.currentPage + 1);
				} else {
					this.changePage(targetPage);
				}
				
			}));
			
			// Paging options
			if (this.pagingOptions && this.pagingOptions.length > 0) {
				bottom.options = dojo.create("select");
				
				for (o in this.pagingOptions) {
					option = this.pagingOptions[o];
					dojo.place(dojo.create("option", { 
						"value" : option.pageValue, innerHTML : option.pageKey}), bottom.options);
					if (option.pageValue == this.defaultRows) {
						bottom.options.options[o].selected = true;
					}
				}
				
				// On change event for paging options
				dojo.connect(bottom.options, "onchange", dojo.hitch(this, function (event) {
					var perPage = event.target.options[event.target.selectedIndex].value;
					this.pageSize = parseInt(perPage, 10);
					this.changePage(0);
				}));
			}
			
			dojo.place(bottom.buttons["first"], bottom.container);
			dojo.place(bottom.buttons["previous"], bottom.container);
			
			dojo.place(dojo.create("label", { innerHTML : "Page "}), bottom.container);
			dojo.place(bottom.input, bottom.container);
			dojo.place(bottom.postInput, bottom.container);
			
			dojo.place(bottom.buttons["next"], bottom.container);
			dojo.place(bottom.buttons["last"], bottom.container);
			
			if (bottom.options) {dojo.place(bottom.options, bottom.container);}
			dojo.place(bottom.text, bottom.container);
			
			dojo.addClass(bottom.container, "dgu-bottom-paging");
			return bottom.container;
		},
		
		createPagingButtons : function () {
			return {
				first : (new mxui.widget.Button({
						iconClass : "glyphicon glyphicon-step-backward",
						onClick : dojo.hitch(this, function () {
							this.changePage(0);
						})
					})).domNode
				,previous : (new mxui.widget.Button({
						iconClass : "glyphicon glyphicon-backward",
						onClick : dojo.hitch(this, function () {
							this.changePage(this.currentPage - 1);
						})
					})).domNode
				,next : (new mxui.widget.Button({
						iconClass : "glyphicon glyphicon-forward",
						onClick : dojo.hitch(this, function () {
							this.changePage(this.currentPage + 1);
						})
					})).domNode
				,last : (new mxui.widget.Button({
						iconClass : "glyphicon glyphicon-step-forward",
						onClick : dojo.hitch(this, function () {
							var lastPage = Math.ceil(this.count / this.pageSize);
							this.changePage(lastPage - 1);
						})
					})).domNode
				};
		},
		
		_setPagingVisibility : function (pgObj, settings) {
			var total = this.count,
				start = total > 0 ? (1 + (this.currentPage * this.pageSize)) : 0,
				end = Math.min(total, start + this.pageSize - 1),
				back = start > 1, 
				forward = total > end,
				display = (back || forward) ? "inline" : "none";
			
			if (pgObj) {
				pgObj.buttons.first.disabled = !back;
				pgObj.buttons.previous.disabled = !back;
				pgObj.buttons.next.disabled = !forward;
				pgObj.buttons.last.disabled = !forward;
				
				if (pgObj.text) {pgObj.text.innerHTML = Math.max(1, start) + " to " + end + " of " + total;}
				if (pgObj.input) {pgObj.input.value = this.currentPage + 1;}
				if (pgObj.postInput) {pgObj.postInput.innerHTML = " of " + Math.max(1, Math.ceil(this.count / this.pageSize));}
				
				if (settings == "only") {
					if (pgObj.text) {dojo.style(pgObj.text, "display", display);}
					dojo.style(pgObj.buttons.first, "display", display);
					dojo.style(pgObj.buttons.previous, "display", display);
					dojo.style(pgObj.buttons.next, "display", display);
					dojo.style(pgObj.buttons.last, "display", display);
				}
				
				
			}
		},
		
		_sortColumn : function (event) {
			var i, col = null, order = "asc", attr, path = "", target = event.target;
			
			if (target.tagName === "SPAN") {
				target = target.parentNode.parentNode;
			} else if (dojo.hasClass(target, 'mx-datagrid-sort-icon')) {
				target = target.parentNode;
			}
			
			// Find the column
			for (i = 0; i < this.columns.length; i++) {
				if (this.columns[i].header === target){
					col = this.columns[i];
					break;
				}
			}
			
			if (!col) {
				console.error("Unknown column to sort on.");
				mx.ui.error("Unknown column to sort on.");
				return;
			} 
			if (col.colDataType !== 'field') {
				console.warn('Can only sort on XPath fields.');
				mx.ui.warning('Can only sort on XPath fields.');
				return;
			}
			
			// Get the path
			if (col.colEntity !== this.entity) {
				path = col.colPath.substring(1, col.colPath.length-1) + "/";
			}
			
			attr = path + col.colAttr;
			
			// Remove display from pervious sorted columns
			for (i = 0; i < this._lastSortedColumns.length; i++) {
				dojo.style(this._lastSortedColumns[i].header.children[0], 'display', 'none');
			}
			
			// If the column is already sorted on, reverse it
			for (i = 0; i < this.sortOrderList.length; i++) {
				if (this.sortOrderList[i][0] === attr) {
					order = this.sortOrderList[i][1] === "asc" ? "desc" : "asc";
					break;
				}
			}
			
			// Set new sorting
			this._lastSortedColumns = [col];
			this.sortOrderList = [[attr, order]];
			
			// Update styling
			dojo.style(col.header.children[0], 'display', '');
			col.header.children[0].children[0].innerHTML = order == "asc" ? '▲' : '▼';
			
			// Search
			this.search(true);
		},
		
		updatePaging : function () {
			this._setPagingVisibility(this._paging["top"], this.topPaging);
			this._setPagingVisibility(this._paging["bottom"], this.bottomPaging);
		},
		
		changePage : function (targetPage) {
			var pages = Math.ceil(this.count / this.pageSize) - 1;
			
			if (targetPage > pages || targetPage < 0) {
				console.error("Invalid page number");
				return;
			}
			
			this.currentPage = targetPage;
			this.search(true, true); // Keep selection as we change the page
		},
		
		updateLoadingScreen : function () {
			if (this.dataPending || this.searchResultsPending > 0 || this.searchDefaultsPending > 0) {
				dojo.style(this._loadingScreen, "display", "inline");
				dojo.style(this._overlay, "display", "inline");
			} else {
				dojo.style(this._loadingScreen, "display", "none");
				dojo.style(this._overlay, "display", "none");
			}
		},
		
		formatXPath : function (constraint, context) {
			var user = mx.session.getUserId();
			
			if (!constraint) {
				return "";
			}
			
			return constraint.replace(/\[%CurrentUser%\]/gi, user)
				.replace(/\[%CurrentObject%\]/gi, context || "");
		},
		
		isValid : function (ruleType, roles, contextObj, attr, val) {
			var hasRoles = !roles || mx.session.hasSomeRole(roles),
				hasCtx = !!contextObj, 
				isBool = hasCtx ? contextObj.isBoolean(attr) : false,
				hasValue = !attr || (hasCtx && 
					(isBool?val==='true':val) === contextObj.get(attr));
			
			if (!roles && !attr) { return true; }
			
			return ruleType == 'all' ? 
				(hasRoles && hasValue) : 
				((roles && hasRoles) || (attr && hasValue));
		},
		
		_executeControlBarMicroflow : function (buttonConfig) {
			var parameters = this._getSelectionParams(buttonConfig.cbBtnMfSel), 
				executeMicroflow;
				
			if (!parameters) {return;}
			
			// Set action
			parameters.actionname = buttonConfig.cbBtnMf;
			
			executeMicroflow = (function (params, config) {
				return function () {
					var underlay, progress, callback;
					
					if (config.cbBtnProgBarType == "block") {
						underlay = true;
						mx.ui.showUnderlay();
					}
					
					if (config.cbBtnProgBarType != "none") {
						progress = mx.ui.showProgress(config.cbBtnProgMsg);
					}
					
					callback = function () {
						if (progress) {mx.ui.hideProgress(progress);}
						if (underlay) {mx.ui.hideUnderlay();}
						if (!config.cbBtnMaintain) {
							this.deselectAll();
						}
					};
					
					mx.data.action({
						params : params, 
						async : config.cbBtnMfCallType === "async",
						callback : dojo.hitch(this, callback),
						error : function (err) {
							console.error(err);
						}
					}, this);
				};
			}(parameters, buttonConfig));
			
			if (buttonConfig.cbBtnAsk) {
				mx.ui.confirmation({
					content: buttonConfig.cbBtnQuestion,
					proceed: buttonConfig.cbBtnProceed,
					cancel: buttonConfig.cbBtnCancel,
					handler: dojo.hitch(this, executeMicroflow)
				});
			} else {
				executeMicroflow();
			}
		},
		
		_getSelectionParams : function (selectionType) {
			var i, xpath, params = {}, constraints = "", len = this._selectedGuids.length;
			var lastArgs = this._lastSearch;
			
			
			if (this._lastSearch.microflow) {
				console.error("Data sources by microflow cannot execute microflows.");
				mx.ui.error("Data sources by microflow cannot execute microflows");
				return null;
			}
			
			if (selectionType === "nothing") {
				params.applyto = "none";
				return params;
			}
			
			params.applyto = "set";
			params.sort = lastArgs.sort || lastArgs.filter.sort;
			xpath = "//" + this.entity;
			
			// XPath
			if (this._selectAll || selectionType === "all") {
				if (lastArgs.path) {
					xpath += "[" + lastArgs.path + "=\"" + this.context + "\"]" + this._getSearchFilterXPath();
				} else {
					xpath = lastArgs.xpath;
				}
			} else {
				xpath = "//" + this.entity;
			}
			
			params.xpath = xpath;
			
			if (selectionType === "selection") {
				// Select all does a NAND query
				if (this._selectAll) {
					
					if (len >= this.count) { // Everything has been deselected
						mx.ui.info("No selection available.");
						return null;
					} 
					
					if (len > 0) {
						constraints += "[id!=\"" + this._selectedGuids[0] + "\"";
						
						for (i = 1; i < len; i++) {
							constraints += " and id!=\"" + this._selectedGuids[i] + "\"";
						}
						
						constraints += "]";
					}
				// Regular selection does an OR
				} else {
					if (len > 0) {
						constraints += "[id=\"" + this._selectedGuids[0] + "\"";
						
						for (i = 1; i < len; i++) {
							constraints += " or id=\"" + this._selectedGuids[i] + "\"";
						}
						
						constraints += "]";
					} else { // Nothing has been selected
						mx.ui.info("No selection available.");
						return null;
					}
				}
				
				params.constraints = constraints;
			}
			
			return params;
		},
		
		setDataLists : function () {
			var i, c, self = this, xpath;
			
			function addAttribute (attr, linkedToColumn) {
				if (self.attributeList.indexOf(attr) == -1) {
						self.attributeList.push(attr);
						self.attributeMetaData.push({columnIndex : (linkedToColumn ? self.columns.indexOf(linkedToColumn) : -1)});
				}
			}
		
			function addReference (entity, path, attr, linkedToColumn) {
				var assoc = path.substring(1, path.length - 1).split("/"),
				assocDepth = assoc.length / 2, counter = 0, currentRef = self.referenceList, temp;
				
				while (counter < assocDepth) {
					temp = currentRef[assoc[counter*2]];
					
					if (!temp) {
						temp = { entityName : assoc[(counter * 2) + 1], references : {}, attributes : [], metaData : [] };
					}
					
					// Reached final entity of association
					if ((counter+1) == assocDepth && temp.attributes.indexOf(attr) == -1) {
						temp.attributes.push(attr);
						temp.metaData.push({columnIndex : (linkedToColumn ? self.columns.indexOf(linkedToColumn) : -1)});
					}
					
					// Set reference
					currentRef[assoc[counter*2]] = temp;
					
					// Reset variables
					currentRef = temp.references;
					counter++;
				}
			}
			
			function addSortOrder (value, dir) {
				var j, exists = false;
				
				// Dupe check
				for (j = 0; i < self.sortOrderList.length; i++) {
					if (self.sortOrderList[j][0] == value) {
						exists = true;
						console.warn("Attribute already exists in sort '" + value + "'");
						break;
					}
				}
				
				if (!exists) {
					self.sortOrderList.push([value, dir]);
				}
			}
			
			// Create attribute list
			for (i = 0; i < this.columns.length; i++) {
				c = this.columns[i];
				
				if (c.visible && c.colDataType === "field") {
					if (c.colEntity === this.entity) {
						addAttribute(c.colAttr, c);
					} else {
						addReference(c.colEntity, c.colPath, c.colAttr, c);
					}
				}
			}
			
			// Get references from sort order & update sort order
			for (i = 0; i < this.sortOrder.length; i++) {
				if (this.sortOrder[i].colAttr.indexOf("/") > -1) {
					xpath = this.sortOrder[i].split("/");
					addReference(xpath[1], "[" + xpath[0] + "/" + xpath[1] + "]", xpath[2]);
				} else {
					addAttribute(this.sortOrder[i].colAttr);
				}
				
				addSortOrder(this.sortOrder[i].colAttr, this.sortOrder[i].sortDirection);
			}
			
		},
		
		uninitialize : function(){
			console.log("Unitialized dgu");
		},
		
		getHashCode : function (str) {
			var i, hash = 0, len = str.length;
			
			for (i = 0; i < len; i++) {
				// s[i]*31^(n-1)
				hash = str[i].charCodeAt() + ((hash << 5) - hash); // *31 == (i << 5) - i
				// Keep 32-bit
				hash &= hash;
			}
			
			return hash;
		},

		stringifyInOrder : function (obj, exclusions) {
			var str = '', prop, type = (typeof obj), keys;
			
			if (type === 'undefined') {return '';}
			
			if (type === 'string' || type === 'boolean' || type === 'number') {
				return obj;
			}
			
			if (type !== 'object') {return '';}
			
			keys = Object.keys(obj).sort();
			
			for (prop in keys) {
				if (obj.hasOwnProperty(keys[prop])) {
					if (!exclusions || exclusions.indexOf(keys[prop]) == -1) {
						str += '{' + keys[prop] + ':' + this.stringifyInOrder(obj[keys[prop]]) + '}';
					}
				}
			}
			
			return str;
		},

		HashObject : function (obj, exclusions) {
			return this.getHashCode(this.stringifyInOrder(obj, exclusions));
		},
		
		_export : function (config) {
			var searchData = this._lastSearch,
				exportAs = config.cbBtnType === "excel" ? "Excel" : "Flat",
				exportType = config.cbExpType,
				max = config.cbExpMaxRows,
				dateFormat = (config.cbExpDtFmt === "date" ? "ExcelDateTime" : "Text"),
				delimiter = config.cbExpDelim;
			
			var exportAmount = (exportType === "wysiwyg") ? Math.min(this._rowData.length, max)
				: Math.min(max, this.count);
			var includeHiddenColumns = (exportType !== "wysiwyg");
			
			if (this.currentDataSource.dataSrc !== 'xpath') {
				mx.ui.warning("Cannot export data.", true);
				console.warn("Cannot export data derived from a microflow data source.");
				return;
			}
			
			searchData.amount = exportAmount;
			if (exportType === "all") { searchData.offset = 0; }
			
			// Attach current grid data
			searchData.metaAttributes = this._getExportMetaAttributes(this.attributeMetaData, includeHiddenColumns);
			this._setExportMetaReferences(searchData.references, includeHiddenColumns);
			
			// Ensure this works for over assocication...mf (think not)?
			mx.data.create({
				entity: "DataGridUltimate.Argument",
				callback: function(argObj) {
					argObj.set("JSON", JSON.stringify(searchData));
					argObj.set("ExportFormat", exportAs);
					argObj.set("ExportDateFormat", dateFormat);
					argObj.set("ExportDelimiter", delimiter);
					mx.data.action({
						params: {
							actionname : "DataGridUltimate.ExportDataByJSON",
							applyto : "selection",
							guids : [argObj.getGUID()]
						},
						callback : function () {console.log("Export complete");},
						error : function (ex) { mxui.error(ex); }
					});
			}});
		},
		
		_getExportMetaAttributes : function (attributeMetaData, includeHidden) {
			var m, index, meta, metaAttributes = [];
			
			for (m = 0; m < attributeMetaData.length; m++) {
				index = attributeMetaData[m].columnIndex;

				if (index > -1) {
					meta = this.columns[index];
					metaAttributes.push({ visible : (meta.visible && (!meta.hidden || includeHidden)), position : meta.position, alias : meta.colName});
				} else {
					metaAttributes.push({ visible : false, position : 9999999, alias : ""});
				}
			}
			
			return metaAttributes;
		},
		
		_setExportMetaReferences : function (references, includeHidden) {
			var ref;
			
			if (!references) { return; }
			
			for (ref in references) {
				//  Set attributes meta data
				references[ref].metaAttributes = this._getExportMetaAttributes(references[ref].metaData, includeHidden);
				
				// Recurse
				this._setExportMetaReferences(references[ref].references);
			}
		}
	});

		}(_$, _jQuery));
	});

});