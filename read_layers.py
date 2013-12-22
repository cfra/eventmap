#!/usr/bin/env python
#
# This file reads the layers in the layers directory
# and creates tilesets out of them.
#
# Additionaly it stores the data in a format so it's
# usable by the web frontend
#

import cairo
import json
import math
import os
import shutil
import stat
import yaml

int_ceil = lambda x : int(math.ceil(x))

def makedirs(dirs):
    try:
        s = os.stat(dirs)
        if stat.S_ISDIR(s.st_mode):
            return
    except Exception:
        pass
    os.makedirs(dirs)


class Layer(object):
    def __init__(self, info, path):
        self.name = info.get('name', None)
        if self.name is None:
            self.name = os.path.splitext(os.path.basename(path))[0]

        self._scale = info.get('scale', 1.0)
        self._x_offset = info.get('x-offset', 0.0)
        self._y_offset = info.get('y-offset', 0.0)
        self._rotate = info.get('rotate', 0.0)

        self._load_file(path)

    @property
    def width(self):
        return self._x_offset + (self._orig_width * self._scale)

    @property
    def height(self):
        return self._y_offset + (self._orig_height * self._scale)

    def draw(self, context):
        context.transform(cairo.Matrix(x0=self._x_offset, y0=self._y_offset))
        context.transform(cairo.Matrix(xx=self._scale, yy=self._scale))
        context.transform(cairo.Matrix.init_rotate(self._rotate))

    def _load_file(self, path):
        raise NotImplementedError

    def __cmp__(self, other):
        return cmp(self.name, other.name)


class PdfLayer(Layer):
    def _load_file(self, path):
        from gi.repository import Poppler
        document = Poppler.Document.new_from_file('file://{0}'.format(path), None)
        self._page = document.get_page(0)

    @property
    def _orig_width(self):
        return self._page.get_size()[0]

    @property
    def _orig_height(self):
        return self._page.get_size()[1]

    def draw(self, context):
        super(PdfLayer, self).draw(context)
        self._page.render(context)


class PngLayer(Layer):
    def _load_file(self, path):
        self._image = cairo.ImageSurface.create_from_png(path)

    @property
    def _orig_width(self):
        return self._image.get_width()

    @property
    def _orig_height(self):
        return self._image.get_height()

    def draw(self, context):
        super(PngLayer, self).draw(context)
        context.set_source_surface(self._image)
        context.paint()


class LayerLoader(object):
    def load(self, layer_path):
        layers = []
        for layer_file in os.listdir(layer_path):
            if layer_file.endswith('.txt'):
                continue
            layer_file = os.path.join(layer_path, layer_file)
            layers.append(self.read(layer_file))
        return layers

    def read(self, path):
        info_file = '{0}.txt'.format(path)
        if os.path.exists(info_file):
            with open(info_file, 'r') as f:
                info = yaml.safe_load(f)
        else:
            info = {}

        if path.endswith('.pdf'):
            return PdfLayer(info, path)
        elif path.endswith('.png'):
            return PngLayer(info, path)
        else:
            raise RuntimeError("Unsupported Format for '{0}'".format(path))


class TileGenerator(object):
    def __init__(self, layer, width=None, height=None, tile_size=None, zoom_step=None, scale=-1):
        self.layer = layer
        self.size = (self.layer.width if width is None else width,
                     self.layer.height if height is None else height)
        self.tile_size = 256 if tile_size is None else tile_size
        self.zoom_step = 2.0 if zoom_step is None else float(zoom_step)
        self.scale = scale
        self.draw_per_plane = True

    def create_tiles(self, path):
        # calculate how many zoom levels we need by getting the largest number with
        # 2 ** max_zoom_level >= max(layer_width / tile_size, layer_height / tile_size)
        max_zoom_level = max([
            int_ceil(math.log(float(self.size[0]) / self.tile_size, self.zoom_step)),
            int_ceil(math.log(float(self.size[1]) / self.tile_size, self.zoom_step))
        ])

        if self.scale >= 0:
            nice_size = self.tile_size * (self.zoom_step ** max_zoom_level)
            prescale = float(nice_size) / self.size[self.scale]
            maybe_greater_zoom_level = int_ceil(math.log(prescale * self.size[1 - self.scale]
                                                         / self.tile_size, self.zoom_step))
            if maybe_greater_zoom_level > max_zoom_level:
                max_zoom_level = maybe_greater_zoom_level
        else:
            prescale = 1.0

        self.layer.max_zoom_level = max_zoom_level
        scaled_size = (self.size[0] * prescale, self.size[1] * prescale)

        # Actual tile rendering starts here
        tile_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, self.tile_size, self.tile_size)
        tile_context = cairo.Context(tile_surface)
        for zoom_level in range(max_zoom_level + 1):
            zoom_factor = self.zoom_step ** -zoom_level
            tiles_x = int_ceil(zoom_factor * scaled_size[0] / self.tile_size)
            tiles_y = int_ceil(zoom_factor * scaled_size[1] / self.tile_size)
            zoom_level_transform = cairo.Matrix(xx=prescale * zoom_factor, yy=prescale * zoom_factor)

            if self.draw_per_plane:
                plane_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32,
                                                   self.tile_size * tiles_x,
                                                   self.tile_size * tiles_y)
                plane_context = cairo.Context(plane_surface)
                plane_context.set_matrix(zoom_level_transform)
                plane_context.set_source_rgba(1.0, 1.0, 1.0, 1.0)
                plane_context.paint()
                layer.draw(plane_context)

            for x in range(tiles_x):
                makedirs(os.path.join(path, str(max_zoom_level - zoom_level), str(x)))
                column_transform = cairo.Matrix(x0=-self.tile_size * x) # Shift image to left for x tiles

                for y in range(tiles_y):
                    tile_path = os.path.join(path, str(max_zoom_level - zoom_level), str(x), '{0}.png'.format(y))
                    tile_transform = column_transform * cairo.Matrix(y0=-self.tile_size * y) # Shift image up for y tiles

                    if self.draw_per_plane:
                        tile_context.set_matrix(tile_transform)
                        tile_context.set_source_surface(plane_surface)
                        tile_context.paint()
                    else:
                        tile_context.set_matrix(zoom_level_transform * tile_transform)
                        tile_context.set_source_rgba(1.0, 1.0, 1.0, 1.0)
                        tile_context.paint()
                        layer.draw(tile_context)

                    tile_surface.write_to_png(tile_path)


class LayerInfoStore(object):
    def __init__(self, layers):
        self.layers = layers

    def store(self, path):
        document = []
        for layer in sorted(self.layers):
            document.append({
                'name': layer.name,
                'max_zoom': layer.max_zoom_level
            })
        with open(path, "w") as f:
            json.dump(document, f)

if __name__ == '__main__':
    layer_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'layers')
    web_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'web')
    tiles_path = os.path.join(web_path, 'images', 'tiles')
    layer_info_path = os.path.join(web_path, 'js', 'layers.json')

    if os.path.exists(tiles_path):
        shutil.rmtree(tiles_path)

    layers = LayerLoader().load(layer_path)
    layer_width = max([layer.width for layer in layers])
    layer_height = max([layer.height for layer in layers])

    for layer in layers:
        tile_generator = TileGenerator(layer, layer_width, layer_height)
        tile_generator.create_tiles(os.path.join(tiles_path, layer.name))

    LayerInfoStore(layers).store(layer_info_path)
