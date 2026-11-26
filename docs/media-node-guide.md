# eduMEET media node guide

This is the media node service for the Edumeet project.

![Overview of room-server, media-node, and browser media connections](../img/edumeet-media-node.drawio.png)

By default, the media node uses RTC ports `40000`–`40249` (250 ports). Each mediasoup worker
creates a shared WebRTC server for its user transports; the worker count defaults to the number of
CPU cores and can be changed with `--numberOfWorkers`. Pipe transports use their own ports: a
same-node pipe between two routers has two endpoints on that node, while a pipe to another media
node has one endpoint on this node.

Choose a range large enough for the worker count and the peak number of pipe-transport endpoints.
The range is used for both UDP and TCP, so allow both protocols through the firewall. To change it
when running manually, use `--rtcMinPort` and `--rtcMaxPort`. To change it in this repository's
Docker image, use the `rtcMinPort` and `rtcMaxPort` build arguments.

## Usage

### Running the service manually

```bash
$ corepack enable
$ yarn install --immutable
$ MEDIA_SECRET=<secret-shared-with-room-server> yarn start --ip <host-listen-ip>
```

The secret can also be given as `--secret <secret>`, but other accounts on the host can read a process's command line, so the `MEDIA_SECRET` environment variable is preferred.
The media node does not start without a secret, and it refuses every connection that does not present it.
Use an address assigned to the host for `--ip`. If the host is behind NAT, also
pass `--announcedIp <public-ip>` so clients receive the reachable address.

To run the service you need to have Node.js version 24 or higher installed. This project uses Yarn 4 via Corepack. Alternatively you can get some debug output by running it like this:

```bash
$ LOG_LEVEL=debug MEDIA_SECRET=<secret-shared-with-room-server> yarn start --ip <host-listen-ip>
```
### Docker
https://github.com/edumeet/edumeet-docker has guidelines for running eduMEET as Docker containers.
