#!/usr/bin/env python
#
# This file reads the layers in the layers directory
# and creates tilesets out of them.
#
# Additionaly it stores the data in a format so it's
# usable by the web frontend
#

import cairo
import math
import os
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
    def __init__(self, name, surface):
        self.name = name
        self._surface = surface

    @property
    def width(self):
        return self._surface.get_width()

    @property
    def height(self):
        return self._surface.get_height()

    def draw(self, context):
        context.set_source_surface(self._surface)
        context.paint()

class LayerReader(object):
    def __init__(self, layer_type=None):
        self.layer_type = Layer if layer_type is None else layer_type

    def read(self, path):
        info_file = '{0}.txt'.format(path)
        if os.path.exists(info_file):
            with open(info_file, 'r') as f:
                info = yaml.safe_load(f)
        else:
            info = {}

        if path.endswith('.pdf'):
            from gi.repository import Poppler
            document = Poppler.Document.new_from_file('file://{0}'.format(path), None)
            page = document.get_page(0)
            orig_width, orig_height = page.get_size()

            def draw_layer(context):
                page.render(context)
        elif path.endswith('.png'):
            image = cairo.ImageSurface.create_from_png(path)
            orig_width, orig_height = image.get_width(), image.get_height()

            def draw_layer(context):
                context.set_source_surface(image)
                context.paint()
        else:
            raise RuntimeError("Unsupported Format for '{0}'".format(path))

        layer_name = info.get('name', None)
        if layer_name is None:
            layer_name = os.path.splitext(os.path.basename(path))[0]

        scale = info.get('scale', 1.0)
        x_offset = info.get('x-offset', 0.0)
        y_offset = info.get('y-offset', 0.0)

        width = int(orig_width * scale + x_offset)
        height = int(orig_height * scale + y_offset)

        layer_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
        layer_context = cairo.Context(layer_surface)

        # Init surface to white
        layer_context.set_source_rgba(1.0, 1.0, 1.0, 1.0)
        layer_context.paint()

        layer_context.translate(x_offset, y_offset)
        layer_context.scale(scale, scale)

        draw_layer(layer_context)
        return self.layer_type(layer_name, layer_surface)

class LayerLoader(object):
    def __init__(self, reader=None):
        self.reader = LayerReader() if reader is None else reader

    def load(self, layer_path):
        layers = []
        for layer_file in sorted(os.listdir(layer_path)):
            if layer_file.endswith('.txt'):
                continue
            layer_file = os.path.join(layer_path, layer_file)
            layers.append(self.reader.read(layer_file))
        return layers

class TileGenerator(object):
    def __init__(self, layer, width=None, height=None, tile_size=None, scale=0):
        self.layer = layer
        self.size = (self.layer.width if width is None else width,
                     self.layer.height if height is None else height)
        self.tile_size = 256 if tile_size is None else tile_size
        self.scale = scale

    def create_tiles(self, path):
        # calculate how many zoom levels we need by getting the largest number with
        # 2 ** max_zoom_level >= max(layer_width / tile_size, layer_height / tile_size)
        max_zoom_level = max([
            int_ceil(math.log(float(self.size[0]) / self.tile_size, 2)),
            int_ceil(math.log(float(self.size[1]) / self.tile_size, 2))
        ])

        if self.scale >= 0:
            nice_size = self.tile_size * (2 ** max_zoom_level)
            prescale = float(nice_size) / self.size[self.scale]
            maybe_greater_zoom_level = int_ceil(math.log(prescale * self.size[1 - self.scale]
                                                / self.tile_size, 2))
            if maybe_greater_zoom_level > max_zoom_level:
                max_zoom_level = maybe_greater_zoom_level
        else:
            prescale = 1.0

        scaled_size = (self.size[0] * prescale, self.size[1] * prescale)

        # Actual tile rendering starts here
        tile_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, self.tile_size, self.tile_size)
        tile_context = cairo.Context(tile_surface)

        layer_transform = cairo.Matrix(xx=prescale, yy=prescale) # Scale by Prescale

        for zoom_level in range(max_zoom_level + 1):
            zoom_factor = 0.5 ** zoom_level
            tiles_x = int_ceil(zoom_factor * scaled_size[0] / self.tile_size)
            tiles_y = int_ceil(zoom_factor * scaled_size[1] / self.tile_size)
            zoom_level_transform = layer_transform * cairo.Matrix(xx=zoom_factor, yy=zoom_factor)

            for x in range(tiles_x):
                makedirs(os.path.join(path, str(max_zoom_level - zoom_level), str(x)))
                column_transform = zoom_level_transform * cairo.Matrix(x0=-self.tile_size * x) # Shift image to left for x tiles

                for y in range(tiles_y):
                    tile_path = os.path.join(path, str(max_zoom_level - zoom_level), str(x), '{0}.png'.format(y))
                    tile_transform = column_transform * cairo.Matrix(y0=-self.tile_size * y)
                    tile_context.set_matrix(tile_transform)
                    print "Matrix for %s is %r" % (tile_path, tile_context.get_matrix())

                    tile_context.set_source_rgba(1.0, 1.0, 1.0, 1.0)
                    tile_context.paint()
                    layer.draw(tile_context)
                    tile_surface.write_to_png(tile_path)


if __name__ == '__main__':
    layer_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'layers')
    tiles_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'tiles')

    layers = LayerLoader().load(layer_path)
    layer_width = max([layer.width for layer in layers])
    layer_height = max([layer.height for layer in layers])

    for layer in layers:
        tile_generator = TileGenerator(layer, layer_width, layer_height)
        tile_generator.create_tiles(os.path.join(tiles_path, layer.name))
