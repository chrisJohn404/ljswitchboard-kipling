

var path = require('path');
var q = global.require('q');
var handlebars = global.require('handlebars');
var module_manager = require('ljswitchboard-module_manager');
var modbus_map = require('ljswitchboard-modbus_map').getConstants();
var fs = require('fs');


var EventEmitter = require('events').EventEmitter;
var util = require('util');

function createModuleChrome() {
	this.moduleChromeStarted = false;

	this.eventList = {
		MODULE_CHROME_STARTED: 'MODULE_CHROME_STARTED',
		LOADING_MODULE: 'LOADING_MODULE',
		MODULE_LOADED: 'MODULE_LOADED',
		MODULE_READY: 'MODULE_READY',
		DEVICE_LIST_UPDATED: 'DEVICE_LIST_UPDATED',
		MODULE_TABS_UPDATED: 'MODULE_TABS_UPDATED',

		// Events triggered by the device selector.
		DEVICE_SELECTOR_DEVICE_OPENED: 'DEVICE_SELECTOR_DEVICE_OPENED',
		DEVICE_SELECTOR_DEVICE_CLOSED: 'DEVICE_SELECTOR_DEVICE_CLOSED',
	};

	var MODULE_CHROME_HOLDER_ID = '#module_chrome_holder';
	var MODULE_CHROME_HEADER_TABS_ID = '#header_tabs';
	var MODULE_CHROME_BODY_TABS_ID = '#body_tabs';
	var MODULE_CHROME_FOOTER_TABS_ID = '#footer_tabs';

	var MODULE_CHROME_HEADER_TABS_CLASS = '.module-chrome-header-tabs';
	var MODULE_CHROME_FOOTER_TABS_CLASS = '.module-chrome-footer-tabs';
	var MODULE_CHROME_BODY_TABS_CLASS = '.module-chrome-body-tabs';

	var MODULE_CHROME_TABS_CLASS = '.module-chrome-tab';

	var MODULE_CHROME_CLICK_ID = 'MODULE_CHROME_CLICK_ID';


	//related to the css styling in: module_chrome.css, ".module-list li", element height + 2
	var TAB_SIZING_STYLE_CLASS = '.module-list li';

	var documentURL;
	try {
		documentURL = document.URL.split('file:///')[1];
	} catch(err) {
		documentURL = '';
	}
	var cwd = path.dirname(documentURL);
	try {
		cwd = decodeURIComponent(cwd);
	} catch(err) {
		cwd = cwd.split('%20').join(' ');
	}
	if(!path.isAbsolute(cwd)) {
		cwd = path.resolve(path.sep, cwd);
	}
	var moduleChromeTemplateName = 'module_chrome.html';
	var moduleChromeTabTemplateName = 'module_tab.html';
	var moduleChromeTemplatesDir = 'templates';

	var sliderTabsClass = '.body-tab';

	var cachedTemplates = {};

	// Initialize variables for communicating with the driver.
	this.io_manager = undefined;
	this.io_interface = undefined;
	this.device_controller = undefined;
	this.device_controller_events = undefined;

	this.cachedDeviceListing = [];

	this.debugFilters = false;

	var loadTemplateFile = function(name) {
		var defered = q.defer();
		var templatePath = path.join(
			cwd,
			moduleChromeTemplatesDir,
			name
		);
		if(!path.isAbsolute(templatePath)) {
			templatePath = path.resolve(path.sep, templatePath);
		}
		// console.log('Executing fs.readFile', {
		// 	'optionA': path.resolve(templatePath),
		// 	'optionB': path.resolve(path.sep, templatePath)
		// });

		fs.readFile(templatePath, function(err, data) {
			var pageStr = '';
			if(err) {
				console.error('Error in loadTemplateFile', err);
				console.error('Data', {
					'path': templatePath,
					'name': name,
					'cwd': cwd,
					'moduleChromeTemplatesDir': moduleChromeTemplatesDir,
				});
				defered.resolve(pageStr);
			} else {
				defered.resolve(data.toString());
			}
		});
		return defered.promise;
	};
	this.clearTemplateCache = function() {
		cachedTemplates = {};
	};
	var compileTemplate = function(name, context) {
		var defered = q.defer();
		if(cachedTemplates[name]) {
			defered.resolve(cachedTemplates[name](context));
		} else {
			loadTemplateFile(name)
			.then(function(templateData) {
				cachedTemplates[name] = handlebars.compile(templateData);
				defered.resolve(cachedTemplates[name](context));
			});
		}
		return defered.promise;
	};
	this.compileTemplate = compileTemplate;

	var enableTabSliding = false;
	var renderTemplate = function(location, name, context) {
		var defered = q.defer();
		compileTemplate(name, context)
		.then(function(compiledData) {
			var bodyTabs;
			if(enableTabSliding) {
				bodyTabs = location.find(sliderTabsClass);
				if(bodyTabs.length > 0) {
					// Perform cool slide affects
					bodyTabs.slideUp(
						function() {
							console.log('Finished Sliding Up');
							location.empty();
							location.append($(compiledData));
							bodyTabs = location.find(sliderTabsClass);
							console.log('Num Found', bodyTabs.length);
							bodyTabs.slideDown(200,
								function() {
								});
							defered.resolve(context);
						});
				} else {
					// Empty & replace
					location.empty();
					location.append($(compiledData));
					bodyTabs = location.find(sliderTabsClass);
					if(bodyTabs.length > 0) {
						bodyTabs.slideDown(200);
					}
					defered.resolve(context);
				}
			} else {
				location.empty();
				location.append($(compiledData));
				bodyTabs = location.find(sliderTabsClass);
					if(bodyTabs.length > 0) {
						bodyTabs.show();
					}
					defered.resolve(context);
			}
		});
		return defered.promise;
	};

	var computeTabSizing = function(numTabs, offset, ele) {
		var tabEl;
		if(ele) {
			tabEl = ele;
		} else {
			tabEl = $(TAB_SIZING_STYLE_CLASS);
		}
		var height = tabEl.height();
		var padding = 2*parseInt(tabEl.css('padding'), 10);
		var marginBottom = parseInt(tabEl.css('margin-bottom'), 10);
		height += (padding + marginBottom);
		height = height * numTabs;
		if(offset) {
			height += offset;
		}
		return height.toString() + 'px';
	};
	this.adjustModuleChromeTabSpacing = function(tabSections, context) {
		var defered = q.defer();
		var headerHeight = computeTabSizing(context.header_modules.length);
		var footerHeight = computeTabSizing(
			context.footer_modules.length,
			-2,
			$(MODULE_CHROME_FOOTER_TABS_CLASS)
		);
		var bottomPadding = computeTabSizing(
			context.footer_modules.length,
			0,
			$(MODULE_CHROME_FOOTER_TABS_CLASS)
		);
		// var bottomPadding = computeTabSizing(
		// 	context.footer_modules.length,
		// 	2
		// );

		$(MODULE_CHROME_HEADER_TABS_CLASS).css('height', headerHeight);
		$(MODULE_CHROME_FOOTER_TABS_CLASS).css('height', footerHeight);
		$(MODULE_CHROME_BODY_TABS_CLASS).css('padding-top', headerHeight);
		$(MODULE_CHROME_BODY_TABS_CLASS).css('padding-bottom', bottomPadding);
		// $(MODULE_CHROME_BODY_TABS_CLASS).css('padding-bottom', footerHeight);
		defered.resolve(tabSections, context);
		return defered.promise;
	};

	var updateVisibleTabs = function(location, context) {
		var defered = q.defer();
		renderTemplate(location, moduleChromeTabTemplateName, context)
		.then(function(context, data) {
			defered.resolve();
		}, defered.reject);
		return defered.promise;
	};

	var internalUpdateModuleListing = function(tabSections, context) {
		var defered = q.defer();
		var promises = [];
		tabSections.forEach(function(tabSection) {
			promises.push(updateVisibleTabs(
				tabSection.location,
				{'modules': tabSection.context}
			));
		});

		// Wait for all of the operations to complete
		q.allSettled(promises)
		.then(function(res) {
			if(context) {
				self.adjustModuleChromeTabSpacing(tabSections, context)
				.then(defered.resolve, defered.reject);
			} else {
				defered.resolve(tabSections, context);
			}
		}, function(err) {
			console.error('Finished Updating Err', err);
			defered.reject(context);
		});
		return defered.promise;
	};

	var attachTabClickHandlers = function(tabSections, context) {
		var defered = q.defer();

		// Loop through each tab-section, ex: header, body, footer.
		tabSections.forEach(function(tabSection) {
			var modules = tabSection.context;

			// Loop through and attach listeners for each tab.
			modules.forEach(function(module) {
				var tabID = '#' + module.name + '-tab';
				var tab = $(tabID);
				tab.on('click', module, moduleChromeTabClickHandler);
			});
		});
		defered.resolve(tabSections, context);
		return defered.promise;
	};

	var innerUpdatePrimaryModuleListing = function(modules) {
		var defered = q.defer();
		var context = {
			'header_modules': modules.header,
			'footer_modules': modules.footer
		};
		var tabSections = [{
			'location': $(MODULE_CHROME_HEADER_TABS_ID),
			'context': context.header_modules,
		}, {
			'location': $(MODULE_CHROME_FOOTER_TABS_ID),
			'context': context.footer_modules,
		}];

		// Begin execution & return a promise.
		internalUpdateModuleListing(tabSections, context)
		.then(attachTabClickHandlers)
		.then(function() {
			defered.resolve(context);
		});
		return defered.promise;
	};
	this.updatePrimaryModuleListing = function() {
		// Get the list of modules and have the inner-function perform logic on
		// acquired data.
		return module_manager.getModulesList()
		.then(innerUpdatePrimaryModuleListing)
		.then(reportModuleTabsUpdated);
	};

	var internalUpdateSecondaryModuleListing = function(modules) {
		var defered = q.defer();
		var context = {
			'modules': modules.body
		};

		var tabSections = [{
			'location': $(MODULE_CHROME_BODY_TABS_ID),
			'context': context.modules,
		}];

		// Begin execution & return a promise.
		internalUpdateModuleListing(tabSections)
		.then(attachTabClickHandlers)
		.then(function() {
			defered.resolve(context);
		});
		return defered.promise;
	};
	var filterOperations = {
		// TODO: Should combine this filter code with the filter code in the
		// io_manager device_keeper.js file.
		'minFW': function(filterValue, deviceAttributes) {
			if(self.debugFilters) {
				console.log('Checking minFW', filterValue, deviceAttributes.FIRMWARE_VERSION);
			}
			if(deviceAttributes.FIRMWARE_VERSION) {
				if(filterValue < deviceAttributes.FIRMWARE_VERSION) {
					return true;
				} else {
					self.filterFlags.isOld = true;
					if(self.debugFilters) {
						console.log('FAILS!');
					}
					return false;
				}
			} else {
				console.error('Firmware Version not found');
				return false;
			}
		},
		'subclass': function(filterValues, deviceAttributes) {
			var isMet = false;
			if(self.debugFilters) {
				console.log('Checking subclass', filterValues, deviceAttributes.productType);
			}
			filterValues.forEach(function(filterValue) {
				if(deviceAttributes.productType.indexOf(filterValue) >= 0) {
					if(self.debugFilters) {
						console.log('Passes!', '"' + filterValue + '"');
					}
					isMet = true;
				}
			});
			return isMet;
		},
		'type': function(filterValue, deviceAttributes) {
			if(self.debugFilters) {
				console.log('Checking type', filterValue, deviceAttributes.productType);
			}
			var isMet = true;
			if(deviceAttributes.productType.indexOf(filterValue) < 0) {
				if(self.debugFilters) {
					console.log('FAILS!');
				}
				isMet = false;
			}
			return isMet;
		}
	};
	var checkDeviceForSupport = function(filters, deviceListing) {
		var passedFilters = filters.some(function(filter) {
			var isSupportedDevice = true;
			var keys = Object.keys(filter);

			// Check each filter to see if the current device meets all filter
			// requirements.
			keys.every(function(key) {

				if(typeof(filterOperations[key]) === 'function') {
					if(self.debugFilters) {
						console.log(
							'Checking Filter - func - Key',
							key,
							filter[key]
						);
					}
					if(!filterOperations[key](filter[key], deviceListing)) {
						isSupportedDevice = false;
						return false;
					}
				} else if(typeof(deviceListing[key]) !== 'undefined') {
					console.log(
						'Checking Filter - attr - Key',
						key,
						deviceListing[key],
						filter[key]
					);
				} else {
					console.log('Checking Filter', key, 'unfound...');
				}
				return true;
			});
			return isSupportedDevice;
		});
		return passedFilters;
	};
	var filterBodyModules = function(module) {
		var showModule = true;
		var isSupportedDevice;
		// If there aren't any connected devices, make sure that no modules are
		// shown.
		if(self.cachedDeviceListing.length === 0) {
			showModule = false;
		} else {
			// If the loaded module has the supportedDevices attribute, execute
			// the filters.
			if(module.supportedDevices) {
				showModule = self.cachedDeviceListing.some(
					function(deviceListing) {
						return checkDeviceForSupport(
							module.supportedDevices,
							deviceListing
						);
					});
			} else {
				if(self.debugFilters || true) {
					console.log('Not Filtering Module', module.humanName, module.name);
				}
			}
		}
		return showModule;
	};
	this.filterFlags = {};
	var filterModulesList = function(modules) {
		var defered = q.defer();
		if(self.debugFilters) {
			console.log('Filtering Secondary modules', modules.body);
			console.log('Device Listing', self.cachedDeviceListing);
		}

		self.filterFlags = {};
		modules.body = modules.body.filter(filterBodyModules);
		defered.resolve(modules);
		return defered.promise;
	};

	var reportModuleTabsUpdated = function(updatedModules) {
		var defered = q.defer();
		self.emit(self.eventList.MODULE_TABS_UPDATED, updatedModules);
		defered.resolve(a,b,c);
		return defered.promise;
	};
	this.updateSecondaryModuleListing = function() {
		// Get the list of modules and have the inner-function perform logic on
		// acquired data.
		return module_manager.getModulesList()
		.then(filterModulesList)
		.then(internalUpdateSecondaryModuleListing)
		.then(reportModuleTabsUpdated);
	};
	var runGC = function(data) {
		var defered = q.defer();
		var gcExecuted = false;
		if(gc) {
			if(gc.call) {
				if(typeof(gc.call) === 'function') {
					gc.call();
					gcExecuted = true;
				}
			}
		}
		if(gcExecuted) {
			// console.log('gc.call executed');
		} else {
			// console.log('gc.call not executed');
		}

		defered.resolve(data);
		return defered.promise;
	};
	this.updateModuleListing = function() {
		var defered = q.defer();

		// Instruct both the primary & secondary modules to update.
		var promises = [
			self.updatePrimaryModuleListing(),
			self.updateSecondaryModuleListing()
		];

		// Wait for all of the operations to complete
		q.allSettled(promises)
		.then(runGC)
		.then(defered.resolve, defered.reject);
		return defered.promise;

	};


	this.moduleLockMessage = '';
	this.disableModuleLoading = function(message) {
		self.allowModuleToLoad = false;
		self.moduleLockMessage = message;
	};
	this.enableModuleLoading = function() {
		self.moduleLockMessage = '';
		self.allowModuleToLoad = true;
	};
	this.allowModuleToLoad = true;
	this.conditionallyClearCaches = function() {
		try {
			var clearCaches = false;
			if(typeof(gui.App.manifest.clearCachesOnModuleLoad) !== "undefined") {
				clearCaches = clearCaches || gui.App.manifest.clearCachesOnModuleLoad;
			}
			if(typeof(gui.App.manifest.test) !== "undefined") {
				clearCaches = clearCaches || gui.App.manifest.test;
			}
			if(clearCaches) {
				if(CLEAR_CACHES) {
					console.log('clearing caches');
					CLEAR_CACHES();
				}
			} else {
				console.log('not clearing caches', 
					clearCaches,
					gui.App.manifest.clearCachesOnModuleLoad,
					gui.App.manifest.test
				);
			}
		} catch(err) {
			console.error('Not Clearing Caches due to error', err);
		}
	};
	var moduleChromeTabClickHandler = function(res) {
		// console.log('Clicked Tab', res.data.name);
		if(self.allowModuleToLoad) {
			self.allowModuleToLoad = false;

			self.conditionallyClearCaches();

			// Clear all selected module styling classes
			$('.module-chrome-tab').removeClass('selected');
			var tabID = '#' + res.data.name + '-tab';
			$(tabID).addClass('selected');

			self.emit(self.eventList.LOADING_MODULE, res);
			MODULE_LOADER.once('MODULE_READY', function(res) {
				self.allowModuleToLoad = true;
				hideInfoMessage();
				hideAlert();
			});
			MODULE_LOADER.loadModule(res.data)
			.then(function(res) {
				self.emit(self.eventList.MODULE_LOADED, res);
				// self.allowModuleToLoad = true;
				// // console.log('Finished Loading Module', res.name);

				// Delete loaded data (commented out to let gc handle it)
				// var keys = Object.keys(res);
				// var i;
				// for(i = 0; i < keys.length; i++) {
				// res[keys[i]] = null;
				// res[keys[i]] = undefined;
				// delete res[keys[i]];
				// }
			}, function(err) {
				self.allowModuleToLoad = true;
				console.error('Error loading module', err);
			});
		} else {
			// console.log('Preventing module from loading');
			if(self.moduleLockMessage) {
				showInfoMessage(self.moduleLockMessage);
			} else {
				showInfoMessage('Please wait for module to finish loading.');
			}
		}
		// Query for the module's data.  Will be replaced by a function call
		// to MODULE_LOADER.
		// module_manager.loadModuleData(res.data);
	};

	var saveDeviceListingData = function(deviceInfoArray) {
		var defered = q.defer();
		console.log('Updated Device Listing', deviceInfoArray);

		self.emit(self.eventList.DEVICE_LIST_UPDATED, deviceInfoArray);

		self.cachedDeviceListing = deviceInfoArray;
		defered.resolve();
		return defered.promise;
	};
	var devlceControllerDeviceListChanged = function() {
		var defered = q.defer();

		// Get updated device listing from the device controller
		self.device_controller.getDeviceListing()
		.then(saveDeviceListingData)
		.then(self.updateSecondaryModuleListing)
		.then(defered.resolve);
		return defered.promise;
	};
	var deviceControllerEventListeners = {
		'DEVICE_CONTROLLER_DEVICE_OPENED': function(eventData) {
			// console.log('MODULE_CHROME, Device List Changed');

			// self.updateSecondaryModuleListing()
			devlceControllerDeviceListChanged();
		},
		'DEVICE_CONTROLLER_DEVICE_CLOSED': function(eventData) {
			// console.log('MODULE_CHROME, Device List Changed');

			// self.updateSecondaryModuleListing()
			devlceControllerDeviceListChanged();
		},
	};
	var attachToDeviceControllerEvents = function(bundle) {
		var defered = q.defer();
		self.io_manager = global.require('ljswitchboard-io_manager');
		self.io_interface = self.io_manager.io_interface();
		self.device_controller = self.io_interface.getDeviceController();
		self.device_controller_events = self.device_controller.eventList;

		var listenerKeys = Object.keys(deviceControllerEventListeners);
		listenerKeys.forEach(function(key) {
			self.device_controller.on(
				self.device_controller_events[key],
				deviceControllerEventListeners[key]
			);
		});

		defered.resolve(bundle);
		return defered.promise;
	};

	this.loadStartupModule = function() {
		var defered = q.defer();

		MODULE_LOADER.loadModuleByName('device_selector')
		.then(defered.resolve, defered.reject);
		return defered.promise;
	};

	var reportModuleChromeStarted = function(res) {
		var defered = q.defer();
		self.emit(self.eventList.MODULE_CHROME_STARTED, res);
		self.moduleChromeStarted = true;
		defered.resolve(res);
		return defered.promise;
	};

	var internalLoadModuleChrome = function() {
		var defered = q.defer();
		var context = {};

		// Render the module chrome template
		renderTemplate(
			$(MODULE_CHROME_HOLDER_ID),
			moduleChromeTemplateName,
			context
		)

		// Update the module chrome window with applicable modules
		.then(self.updateModuleListing)

		// Attach to important device_controller events.
		.then(attachToDeviceControllerEvents)

		// Instruct the startup module to load, aka the device_selector
		.then(self.loadStartupModule)

		// Report that the module chrome has started
		.then(reportModuleChromeStarted)

		// Update the module chrome window with applicable modules
		.then(self.updateModuleListing)

		.then(defered.resolve, defered.reject);
		return defered.promise;
	};
	// Almost identical to the "internalLoadModuleChrome", however it doesn't
	// start the device_selector module.
	var loadTestModuleChrome = function() {
		var defered = q.defer();
		var context = {};

		// Render the module chrome template
		renderTemplate(
			$(MODULE_CHROME_HOLDER_ID),
			moduleChromeTemplateName,
			context
		)

		// Update the module chrome window with applicable modules
		.then(self.updateModuleListing)

		// Attach to important device_controller events.
		.then(attachToDeviceControllerEvents)

		// Report that the module chrome has started
		.then(reportModuleChromeStarted)

		.then(defered.resolve, defered.reject);
		return defered.promise;
	};
	this.reloadModuleChrome = function() {
		return internalLoadModuleChrome();
	};
	this.loadModuleChrome = function() {
		if(gui.App.manifest.test) {
			return loadTestModuleChrome();
		} else {
			return internalLoadModuleChrome();
		}
	};

	this.testLoad = function() {
		self.loadModuleChrome()
		.then(function(res) {
			console.log('Template File', res);
		});
	};
	var self = this;
}
util.inherits(createModuleChrome, EventEmitter);

var MODULE_CHROME = new createModuleChrome();
