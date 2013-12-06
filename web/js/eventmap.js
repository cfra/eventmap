var map;
var layers = {};

$(function() {
	map = L.map('map', {
		center: new L.LatLng(70,-50),
		zoom: 2
	});
	$.getJSON('js/layers.json', function(data) {
		$.each(data, function(layer_index, layer_info) {
			var layer_path;
			var layer;
			
			layer_path = 'images/tiles/' + layer_info.name
			        	+ '/{z}/{x}/{y}.png';

			layer = L.tileLayer(layer_path, {
				noWrap: true,
				continuousWorld: true,
				maxZoom: layer_info.max_zoom
			})

			if (!layers.length)
				layer.addTo(map);
			layers[layer_info.name] = layer;
		});
		L.control.layers(layers, {}).addTo(map);
	});
});
