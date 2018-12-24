#!/usr/bin/env python
#
# This file serves the static files in the
# web directory and provides API endpoints
# to read/write the existing markers.
#

import os
from cStringIO import StringIO
import hashlib
import threading
import json
import os
import time
import sys
import threading

import cherrypy

ST_RDONLY = 1

class SynchronizedJSONAutoLoader(threading.Thread):
    def __init__(self, synchronized_json):
        self._synchronized_json = synchronized_json
        super(SynchronizedJSONAutoLoader, self).__init__()

    def run(self):
        print "Autoloader Starting up"
        time.sleep(2)
        while cherrypy.engine.state == cherrypy.engine.states.STARTED:
            time.sleep(1)
            with self._synchronized_json.lock:
                self._synchronized_json.load()
        print "Autoloader Exiting"

class SynchronizedJSON(object):
    def __init__(self, filename):
        self._filename = filename
        self.lock = threading.Lock()

        with self.lock:
            self.cur = {
                'data': None
            }
            self.load()

        stat = os.statvfs(self._filename)
        if stat.f_flag & ST_RDONLY:
            self.start_autoloader()

    def start_autoloader(self):
        self._autoloader = SynchronizedJSONAutoLoader(self)
        self._autoloader.start()

    def load(self):
        assert self.lock.locked()
        self._new = {}
        if os.path.exists(self._filename):
            with open(self._filename, 'rb') as f:
                self._new['data'] = f.read()
        else:
            self._new['data'] = '{}'

        if self.cur['data'] == self._new['data']:
            return

        self._update_sync_id()
        self.cur = self._new

    def _update_sync_id(self):
        doc = json.loads(self._new['data'])
        if 'sync-id' in doc:
            del doc['sync-id']
        hashed_data = json.dumps(doc)
        h = hashlib.sha256()
        h.update(hashed_data)
        doc['sync-id'] = h.hexdigest()
        self._new['data'] = json.dumps(doc, indent=4)
        self._new['sync-id'] = h.hexdigest()

    def set_data(self, data):
        assert self.lock.locked()

        if self.cur['data'] == data:
            return

        self._new = {}
        self._new['data'] = data
        self._update_sync_id()

        with open(self._filename + '.new', 'wb') as f:
            f.write(self._new['data'])
            f.flush()
            os.fsync(f.fileno())
        os.rename(self._filename + '.new', self._filename)

        self.cur = self._new

class EventMapMarkerApi(object):
    def __init__(self, path):
        self.marker_doc = SynchronizedJSON(os.path.join(path, 'markers.json'))

    @cherrypy.expose
    def get(self):
        cherrypy.response.headers['Content-Type']= 'application/json'
        return self.marker_doc.cur['data']

    @cherrypy.expose
    def poll(self, current):
        cherrypy.response.headers['Content-Type']= 'application/json'
        counter = 0
        while self.marker_doc.cur['sync-id'] == current:
            time.sleep(1)
            counter += 1
            if counter >= 20:
                yield ' '
                counter = 0
            if cherrypy.engine.state != cherrypy.engine.states.STARTED:
                break
        yield self.marker_doc.cur['data']

    @cherrypy.expose
    def post(self):
        content_length = cherrypy.request.headers['Content-Length']
        data = cherrypy.request.body.read(int(content_length))

        doc = json.loads(data)

        with self.marker_doc.lock:
            if self.marker_doc.cur['sync-id'] != doc['sync-id']:
                raise cherrypy.HTTPError(503, "Sorry, but the server database changed in between.")
            if 'version' not in doc or doc['version'] != '23.1':
                raise cherrypy.HTTPError(503, "Sorry, but your local script is out of date. Please reload.")
            self.marker_doc.set_data(data)
        cherrypy.response.headers['Content-Type']= 'application/json'
        return '{}'

class EventMapApi(object):
    def __init__(self, path):
        self.markers = EventMapMarkerApi(path)

def test_log(msg, level):
    print "%s, %s" % (msg, level)

if __name__ == '__main__':
    publish = len(sys.argv) >= 2 and sys.argv[1] == '-P'
    current_dir = os.path.dirname(os.path.abspath(__file__))
    cherrypy.engine.subscribe('log', test_log)
    cherrypy.config.update({
        'server.socket_host': '0.0.0.0' if publish else '127.0.0.1',
        'server.socket_port': 8023,
        'server.thread_pool_max': 500,
        'server.thread_pool': 100,
        'log.screen': True
    })

    cherrypy.tree.mount(None, '/', {
        '/': {
            'tools.staticdir.on': True,
            'tools.staticdir.dir': os.path.join(current_dir, 'web'),
            'tools.staticdir.index': 'index.html',
        }
    })

    data_dir = os.path.join(current_dir, 'data') if publish else current_dir
    cherrypy.tree.mount(EventMapApi(data_dir), '/api', {
        '/': {
            'response.timeout': 600,
            'response.stream': True
        }
    })

    if hasattr(cherrypy.engine, "signals"):
        cherrypy.engine.signals.subscribe()
    else:
        if hasattr(cherrypy.engine, "signal_handler"):
            cherrypy.engine.signal_handler.subscribe()
        if hasattr(cherrypy.engine, "console_control_handler"):
            cherrypy.engine.console_control_handler.subscribe()
    cherrypy.engine.start()
    cherrypy.engine.block()
