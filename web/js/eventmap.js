var map;
var draw_control;
var layers = {};
var layer_infos = {};
var recorded_obj;
var marker_store = {};
var marker_store_sync_id;

function active_layer_name() {
	var layer_found = undefined;
	$.each(layers, function(layer_name, layer_object) {
		if (map.hasLayer(layer_object)) {
			layer_found = layer_name;
			return false;
		}
	});
	return layer_found;
}

function active_layer() {
	return layers[active_layer_name()];
}

function active_layer_info() {
	return layer_infos[active_layer_name()];
}

function eventmap_send_update() {
	var update_doc = {
		'sync-id': marker_store_sync_id,
		'markers': {}
	};

	$.each(marker_store, function(marker_name, marker) {
		update_doc.markers[marker_name] = {};

		var marker_info = update_doc.markers[marker_name];

		if (marker_name.startsWith("__polyline")) {
			/* Polyline */
			marker_info.points = [];
			$.each(marker.getLatLngs(), function(index, point) {
				marker_info.points.push({
					lat: point.lat,
					lng: point.lng
				});
			});
			marker_info.layer = marker.options.layer_name;
			marker_info.type = marker.options.type;
		} else {
			/* Regular marker */
			marker_info.lat = marker.getLatLng().lat;
			marker_info.lng = marker.getLatLng().lng;
			marker_info.layer = marker.options.layer_name;
		}
	});

	$.ajax({
		url: 'api/markers/post',
		type: 'POST',
		contentType: 'application/json',
		data: JSON.stringify(update_doc),
		processData: false,
		dataType: 'json'
	}).fail(function(){
		alert("Couldn't send update to server. It is not saved.");
	});
}

function LoadingException(message) {
	this.message = message;
	this.name = "LoadingException";
}

var polyline_styles = {
	"Unknown": { color: 'grey', dashArray: '' },
	"Power": { color: 'red', dashArray: '' },
	"Network": { color: 'blue', dashArray: '' },
	"Wifi": { color: 'blue', dashArray: '1, 10' }
};

function polyline_set_type(marker, type) {
	marker.setStyle(polyline_styles[type]);
	marker.options.type = type;
}

function process_polyline_update(marker_name, marker_info) {
	if (marker_name in marker_store) {
		var marker = marker_store[marker_name];

		/* TODO: compare array, update only on change*/
		marker.setLatLngs(marker_info.points);
		if (marker.options.type != marker_info.type)
			polyline_set_type(marker, marker_info.type);

		marker.options.sync_id = marker_store_sync_id;
		console.log("Kept polyline '" + marker_name + "'.");
	} else {
		var marker = L.polyline(marker_info.points);
		var target_layer_group;

		marker.options.label_text = marker_name;
		marker_store[marker_name] = marker;

		marker.options.layer_name = marker_info.layer;
		marker.options.label_text = marker_name;
		target_layer_group = layers[marker_info.layer];
		if (target_layer_group === undefined) {
			throw new LoadingException("Don't know about layer '"
					+ marker_info.layer + "'!");
		}

		target_layer_group.getLayers()[1].addLayer(marker);
		if (marker_info.type !== undefined) {
			polyline_set_type(marker, marker_info.type);
		} else {
			polyline_set_type(marker, "Unknown");
		}
		marker.options.sync_id = marker_store_sync_id;
		add_contextmenu(marker);
		console.log("Added polyline '" + marker_name + "'.");
	}
}

function eventmap_process_update(data) {
	if (typeof data == "string")
		data = JSON.parse(data);
	marker_store_sync_id = data['sync-id'];
	if (data['markers'] !== undefined)
	    $.each(data['markers'], function(marker_name, marker_info) {
		if (marker_name.startsWith("__polyline"))
			return process_polyline_update(marker_name, marker_info);

		/* Regular marker */
		if (marker_name in marker_store) {
			var marker = marker_store[marker_name];
			var marker_pos = marker.getLatLng();

			if (marker_pos.lat != marker_info.lat
			    || marker_pos.lng != marker_info.lng)
				marker.setLatLng([marker_info.lat, marker_info.lng]);

			if (marker.options.layer_name != marker_info.layer) {
				var old_lg = layers[marker.options.layer_name];
				var new_lg = layers[marker_info.layer];

				var old_draw = old_lg.getLayers()[1];
				var new_draw = new_lg.getLayers()[1];

				old_draw.removeLayer(marker);
				new_draw.addLayer(marker);
				marker.options.layer_name = marker_info.layer;
			}
			marker.options.sync_id = marker_store_sync_id;
			console.log("Kept marker '" + marker_name + "'.");
		} else {
			var marker = L.marker([marker_info.lat, marker_info.lng]);
			var target_layer_group;

			marker.bindLabel('', {
				noHide: marker_labels_no_hide
			});

			add_contextmenu(marker);

			marker.options.label_text = marker_name;
			marker.updateLabelContent(marker.options.label_text);
			marker_store[marker_name] = marker;

			marker.options.layer_name = marker_info.layer;
			target_layer_group = layers[marker_info.layer];
			if (target_layer_group === undefined) {
				throw new LoadingException("Don't know about layer '"
						+ marker_info.layer + "'!");
			}

			target_layer_group.getLayers()[1].addLayer(marker);
			marker.options.sync_id = marker_store_sync_id;
			console.log("Added marker '" + marker_name + "'.");
		}
	});

	for (var marker_name in marker_store) {
		if (marker_store[marker_name].options.sync_id ==
				marker_store_sync_id)
			continue;

		var marker = marker_store[marker_name];
		layers[marker.options.layer_name].getLayers()[1].removeLayer(marker);
		delete marker_store[marker_name];
		console.log("Removed marker '" + marker_name + "'.");
	}

	(function longpoll() {
		$.ajax({
			url: 'api/markers/poll/' + marker_store_sync_id,
			timeout: 600000
		}).done(eventmap_process_update).fail(function() {
			setTimeout(longpoll, 10000);
		});
	})();
}

function delete_marker(marker) {
	layers[marker.options.layer_name].getLayers()[1].removeLayer(marker);
	delete marker_store[marker.options.label_text];
	eventmap_send_update();
}

function add_polyline_contextmenu(marker) {
	/* TODO: Generated menu from polyline styles */
	marker.bindContextMenu({
		contextmenu: true,
		contextmenuItems: [
			{
				text: 'Delete',
				callback: function() {
					delete_marker(marker);
				}
			},
			{
				text: 'Power -> Type',
				callback: function() {
					polyline_set_type(marker, "Power");
					eventmap_send_update();
				}
			},
			{
				text: 'Network -> Type',
				callback: function() {
					polyline_set_type(marker, "Network");
					eventmap_send_update();
				}
			},
			{
				text: 'Wifi -> Type',
				callback: function() {
					polyline_set_type(marker, "Wifi");
					eventmap_send_update();
				}
			},
			{
				text: 'Unknown -> Type',
				callback: function() {
					polyline_set_type(marker, "Unknown");
					eventmap_send_update();
				}
			}
		]
	});
}

function add_contextmenu(marker) {
	if (marker.options.label_text !== undefined
	    && marker.options.label_text.startsWith("__polyline"))
		return add_polyline_contextmenu(marker);

	marker.options.contextmenu = true;
	marker.options.contextmenuItems = [
		{
			text: 'Move',
			callback: function() {
				move_marker(marker);
			}
		},
		{
			text: 'Rename',
			callback: function() {
				rename_marker(marker);
			}
		},
		{
			text: 'Delete',
			callback: function() {
				delete_marker(marker);
			}
		},
	];
	$.each(layers, function(layer_name, layer_object) {
		marker.options.contextmenuItems.push({
			text: 'Send to ' + layer_name,
			callback: function() {
				$.each(layers, function(key, value) {
					map.removeLayer(value);
					drawing_layer = value.getLayers()[1];
					if (drawing_layer.hasLayer(marker))
						drawing_layer.removeLayer(marker);
				});
				map.addLayer(layer_object);
				layer_object.getLayers()[1].addLayer(marker);
				marker.options.layer_name = layer_name;
				eventmap_send_update();
			}
		})
	});
	marker._initContextMenu();
}

/* Functionality of (re)naming a marker - if I understood how objects worked
 * in javascript, this should probably be one. :/
 */
function rename_marker(marker) {
	var label_text;
	var new_label_text;

	if (marker.options.label_text === undefined)
		label_text = '';
	else
		label_text = marker.options.label_text;

	do {
		new_label_text = prompt("Please enter name", label_text);
		if (new_label_text.startsWith("__")) {
			alert("This name is not valid!");
			continue;
		}
		if (new_label_text in marker_store
		    && marker_store[new_label_text] !== marker) {
			alert("This name is not unique!");
		} else {
			break;
		}
	} while (1);

	if (marker.options.label_text !== undefined)
		delete marker_store[label_text]

	marker.options.label_text = new_label_text;
	marker.updateLabelContent(marker.options.label_text);

	marker_store[new_label_text] = marker
	eventmap_send_update();
}

/* Functionality of moving a marker - if I understood how objects worked
 * in javascript, this should probably be one. :/
 */
var move_marker_orig_latlng;
var move_marker_marker;

function move_marker_mousemove(e) {
	move_marker_marker.setLatLng(e.latlng);
}

function move_marker_enable_events() {
	L.DomEvent.addListener(map._container, 'keyup', move_marker_keyup);
	map.on('mousemove', move_marker_mousemove)
	map.on('click', move_marker_commit);
	move_marker_marker.on('click', move_marker_commit);
}

function move_marker_disable_events() {
	L.DomEvent.removeListener(map._container, 'keyup', move_marker_keyup);
	map.off('mousemove', move_marker_mousemove);
	map.off('click', move_marker_commit);
	move_marker_marker.off('click', move_marker_commit);
}

function move_marker_commit(e) {
	move_marker_disable_events();
	eventmap_send_update();
}

function move_marker_keyup(e) {
	if (e.keyCode === 27) {
		move_marker_marker.setLatLng(move_marker_orig_latlng);
		move_marker_disable_events();
	}
}

function move_marker(marker) {
	move_marker_marker = marker;
	move_marker_orig_latlng = marker.getLatLng();
	move_marker_enable_events();
}

/* other functionality */
var marker_labels_no_hide = false;
function marker_labels_calc_nohide(e) {
	marker_labels_no_hide = (map.getZoom() >= 3);
	$.each(layers, function(layer_name, layer_group) {
		var drawing_layer;

		drawing_layer = layer_group.getLayers()[1]
		$.each(drawing_layer.getLayers(), function(marker_index, marker) {
			if (marker.options.label_text !== undefined
			    && marker.options.label_text.startsWith("__"))
				return true;
			marker.setLabelNoHide(marker_labels_no_hide);
		});
	});
}

function polyline_added(e) {
	var created_object_type = e.layerType;
	var created_object = e.layer;
	var layer_name = active_layer_name();
	var layer = active_layer();

	layer.getLayers()[1].addLayer(created_object);
	created_object.options.layer_name = layer_name;

	var index = 0;
	var marker_name;

	do {
		marker_name = "__polyline_" + layer_name + "_" + index;
		index++;
	} while (marker_name in marker_store);

	marker_store[marker_name] = created_object;
	created_object.options.label_text = marker_name;
	add_contextmenu(created_object);
	polyline_set_type(created_object, "Unknown");
	eventmap_send_update();
	return false;
}

L.LatLng.prototype.distanceTo = function(other) {
	var point_t = map.options.crs.latLngToPoint(this, 6);
	var point_o = map.options.crs.latLngToPoint(L.latLng(other), 6);

	return point_t.distanceTo(point_o);
}

var old_readable_distance = L.GeometryUtil.readableDistance
L.GeometryUtil.readableDistance = function(distance, unit) {
	var divider;

	if (active_layer_info().divider !== undefined)
		divider = active_layer_info().divider;
	else
		divider = 1;

	return old_readable_distance(distance/divider,unit);
};

$(function() {
	$("#progress").html("Initializing map...");
	map = L.map('map', {
		center: new L.LatLng(70,-50),
		contextmenu: true,
		continuousWorld: true,
		zoom: 2
	});

	map.on('zoomend', marker_labels_calc_nohide);

	draw_control = new L.Control.Draw({
		draw: {
			polyline: true,
			polygon: false,
			rectangle: false,
			circle: false,
		}
	});
	map.addControl(draw_control);

	var search_control = new L.Control.Search({
		callData: function(input, callback) {
			var input_lower = input.toLowerCase();
			var records = [];

			for (var key in marker_store) {
				if (key.startsWith("__polyline"))
					continue;
				if (key.toLowerCase().indexOf(input_lower) != 0)
					continue;

				var marker = marker_store[key];
				records.push({
					title: key,
					loc: marker.getLatLng()
				});
			}
			records.sort(function(a,b) {
				if (a.title < b.title)
					return -1;
				if (a.title > b.title)
					return 1;
				return 0;
			});
			callback(records);
		}
	});
	search_control.on('search_locationfound', function(location_info) {
		var marker = marker_store[location_info.text];
		for (var key in layers) {
			map.removeLayer(layers[key]);
		}
		map.addLayer(layers[marker.options.layer_name]);
		if (search_control._markerLoc !== undefined) {
			search_control._markerLoc.show();
			search_control._markerLoc.animate();
		}
	});
	map.addControl(search_control);

	map.on('draw:created', function (e) {
		var created_object_type = e.layerType;
		var created_object = e.layer;

		if (created_object_type === 'polyline') {
			return polyline_added(e);
		}
		
		if (created_object_type !== 'marker') {
			console.log("Other Type drawn:");
			console.log(created_object_type);
			return;
		}

		created_object.bindLabel('', {
			noHide: marker_labels_no_hide
		});

		var layer_name = active_layer_name();
		var layer = active_layer();

		add_contextmenu(created_object);

		layer.getLayers()[1].addLayer(created_object);
		created_object.options.layer_name = layer_name;
		rename_marker(created_object);
		/* update will be sent by "rename_marker" */
	});

	$("#progress").html("Retrieving layer info...");
	$.getJSON('js/layers.json', function(data) {
		$("#progress").html("Creating layers...");
		var first_layer = true;
		$.each(data, function(layer_index, layer_info) {
			var layer_path;
			var base_layer;
			var drawing_layer;
			var layer;
			
			layer_path = 'images/tiles/' + layer_info.name
			        	+ '/{z}/{x}/{y}.png';

			base_layer = L.tileLayer(layer_path, {
				noWrap: true,
				continuousWorld: true,
				maxZoom: layer_info.max_zoom
			});

			drawing_layer = new L.FeatureGroup();

			layer = L.layerGroup([base_layer, drawing_layer]);
			layers[layer_info.name] = layer;
			layer_infos[layer_info.name] = layer_info;

			if (first_layer) {
				map.addLayer(layer);
				first_layer = false;
			}
		});
		var layer_control = L.control.layers(layers, {});
		map.on('baselayerchange', function() {
			if (search_control._markerLoc !== undefined)
				search_control._markerLoc.hide();
		});
		layer_control.addTo(map);

		$("#progress").html("Loading marker info...");
		$.ajax({
			url: 'api/markers/get'
		}).done(function(data) {
			$("#progress").html("Processing marker info...");
			try {
				eventmap_process_update(data);
			} catch (e) {
				if (e instanceof LoadingException) {
					$("#progress").html("Error: " + e.message);
				} else {
					$("#progress").html("Unknown error while "
						+ "loading marker info.");
					throw e;
				}
				return;
			}
			$("#progress").html("Loading complete.");
			setTimeout(function() {
				$("#overlay").hide();
			}, 300);
		}).fail(function() {
			$("#progress").html("Error retrieving marker info," +
				            " please retry.");
		});
	});
});
