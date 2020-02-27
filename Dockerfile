FROM python:3.8.1-buster
MAINTAINER nobody@nowhere.ws

RUN mkdir /srv/eventmap
WORKDIR /srv/eventmap
COPY requirements.txt /srv/eventmap/requirements.txt

RUN pip3 install -r requirements.txt

COPY ./ /srv/eventmap

VOLUME [ "/srv/eventmap/data" ]

CMD [ "python", "run_server.py", "-P" ]

EXPOSE 8023
