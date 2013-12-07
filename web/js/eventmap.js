var map;
var draw_control;
var layers = {};
var recorded_obj;

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
	/* notify about editing */
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

$(function() {
	map = L.map('map', {
		center: new L.LatLng(70,-50),
		contextmenu: true,
		zoom: 2
	});

	draw_control = new L.Control.Draw({
	});
	map.addControl(draw_control);

	map.on('draw:created', function (e) {
		var created_object_type = e.layerType;
		var created_object = e.layer;

		if (created_object_type === 'marker') {
			created_object.bindPopup('A popup!');
		}

		$.each(layers, function(layer_name, layer_object) {
			if (!map.hasLayer(layer_object))
				return true;

			created_object.options.contextmenu = true;
			created_object.options.contextmenuItems = [
				{
					text: 'Move',
					callback: function() {
						move_marker(created_object);
					}
				}
			];
			$.each(layers, function(layer_name, layer_object) {
				created_object.options.contextmenuItems.push({
					text: 'Send to ' + layer_name,
					callback: function() {
						$.each(layers, function(key, value) {
							map.removeLayer(value);
							drawing_layer = value.getLayers()[1];
							if (drawing_layer.hasLayer(created_object))
								drawing_layer.removeLayer(created_object);
						});
						map.addLayer(layer_object);
						layer_object.getLayers()[1].addLayer(created_object);
						/* possibly notify about move */
					}
				})
			});
			created_object._initContextMenu();

			layer_object.getLayers()[1].addLayer(created_object);
			recorded_obj = created_object;
			return false;
		});
	});

	$.getJSON('js/layers.json', function(data) {
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

			if (first_layer) {
				map.addLayer(layer);
				first_layer = false;
			}
		});
		L.control.layers(layers, {}).addTo(map);
	});
});
