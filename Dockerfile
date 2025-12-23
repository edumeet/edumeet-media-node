FROM node:22-bookworm-slim

ARG listenPort=3000
ENV LISTEN_PORT=$listenPort

ARG rtcMinPort=40000
ENV RTC_MIN_PORT=$rtcMinPort

ARG rtcMaxPort=40249
ENV RTC_MAX_PORT=$rtcMaxPort

WORKDIR /usr/src/app

COPY . .

RUN yarn install --frozen-lockfile
RUN yarn run build

EXPOSE ${LISTEN_PORT}
EXPOSE ${RTC_MIN_PORT}-${RTC_MAX_PORT}/udp
EXPOSE ${RTC_MIN_PORT}-${RTC_MAX_PORT}/tcp

ENTRYPOINT DEBUG=edumeet:* yarn run prodstart --listenPort ${LISTEN_PORT} --rtcMinPort ${RTC_MIN_PORT} --rtcMaxPort ${RTC_MAX_PORT} $0 $@
