#!/bin/sh

echo "Generating Tilesets..."
python read_layers.py || exit 1
echo "Done. Starting Server."
exec python run_server.py -P
