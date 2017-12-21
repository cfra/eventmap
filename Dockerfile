FROM debian:stretch
MAINTAINER nobody@nowhere.ws

COPY . /srv/eventmap
WORKDIR /srv/eventmap

RUN set -x \
	&& apt-get update && apt-get install -y --no-install-recommends \
		python-cairo \
		python-gi \
		python-gobject \
		python-pip \
		python-setuptools \
		python-wheel \
	&& pip install -r requirements.txt

VOLUME [ "/srv/eventmap/layers", "/srv/eventmap/data" ]

CMD [ "python", "run_server.py" ]

EXPOSE 8023
