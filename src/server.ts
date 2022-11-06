process.title = 'edumeet-media-node';

import minimist from 'minimist';
import fs from 'fs';
import os from 'os';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import { Logger } from './common/logger';
import { SocketIOConnection } from './signaling/SocketIOConnection';
import { interactiveServer } from './interactiveServer';
import MediaService from './MediaService';
import RoomServer from './RoomServer';
import { RoomServerConnection } from './RoomServerConnection';

const logger = new Logger('MediaNode');

const showUsage = () => {
	logger.debug('Usage:');
	logger.debug('  --listenPort <port> (optional, default: 3000)');
	logger.debug('    The port to listen for incoming connections socket connections.\n\n');
	logger.debug('  --listenHost <host> (optional, default: 0.0.0.0)');
	logger.debug('    The host to listen for incoming connections socket connections.\n\n');
	logger.debug('  --secret <string> (optional, default: none)');
	logger.debug('    The secret to use for authenticating with the room server.\n\n');
	logger.debug('  --cert <path> (optional, default: ./certs/edumeet-demo-cert.pem)');
	logger.debug('    The path to the certificate file used for socket.\n\n');
	logger.debug('  --key <path> (optional, default: ./certs/edumeet-demo-key.pem)');
	logger.debug('    The path to the key file used for socket.\n\n');
	logger.debug('  --ip <ip> (required)');
	logger.debug('    The IP address used to create mediasoup transports.\n\n');
	logger.debug('  --announcedIp <ip> (optional, default: none)');
	logger.debug('    The IP address to be announced to clients for mediasoup transports.\n\n');
	logger.debug('  --initialAvailableOutgoingBitrate <bitrate> (optional, default: 600000)');
	logger.debug('    The initial available outgoing bitrate for mediasoup transports.\n\n');
	logger.debug('  --maxIncomingBitrate <bitrate> (optional, default: 10000000)');
	logger.debug('    The max incoming bitrate for mediasoup transports.\n\n');
	logger.debug('  --maxOutgoingBitrate <bitrate> (optional, default: 10000000)');
	logger.debug('    The max outgoing bitrate for mediasoup transports.\n\n');
	logger.debug('  --rtcMinPort <port> (optional, default: 40000)');
	logger.debug('    The lower bound port for mediasoup transport.\n\n');
	logger.debug('  --rtcMaxPort <port> (optional, default: 40249)');
	logger.debug('    The upper bound port for mediasoup transport.\n\n');
	logger.debug('  --numberOfWorkers <num> (optional, default: number of host cores)');
	logger.debug('    The number of mediasoup workers to create.\n\n');
};

(async () => {
	const {
		help,
		usage,
		listenPort = 3000,
		listenHost = '0.0.0.0',
		secret,
		cert = './certs/edumeet-demo-cert.pem',
		key = './certs/edumeet-demo-key.pem',
		ip,
		announcedIp,
		initialAvailableOutgoingBitrate = 600000,
		maxIncomingBitrate = 10000000,
		maxOutgoingBitrate = 10000000,
		rtcMinPort = 40000,
		rtcMaxPort = 40249,
		numberOfWorkers = os.cpus().length,
	} = minimist(process.argv.slice(2));
	
	if (!ip || help || usage) {
		showUsage();
	
		return process.exit(1);
	}

	logger.debug('Starting...', { listenPort, listenHost, ip, announcedIp });

	const roomServerConnections = new Map<string, RoomServerConnection>();
	const roomServers = new Map<string, RoomServer>();

	const mediaService = await MediaService.create({
		ip,
		announcedIp,
		initialAvailableOutgoingBitrate,
		maxIncomingBitrate,
		maxOutgoingBitrate,
		rtcMinPort,
		rtcMaxPort,
		numberOfWorkers,
	}).catch((error) => {
		logger.error('MediaService creation failed: %o', error);

		return process.exit(1);
	});

	interactiveServer(mediaService, roomServerConnections, roomServers);

	const httpsServer = https.createServer({
		cert: fs.readFileSync(cert),
		key: fs.readFileSync(key),
		minVersion: 'TLSv1.2',
		ciphers: [
			'ECDHE-ECDSA-AES128-GCM-SHA256',
			'ECDHE-RSA-AES128-GCM-SHA256',
			'ECDHE-ECDSA-AES256-GCM-SHA384',
			'ECDHE-RSA-AES256-GCM-SHA384',
			'ECDHE-ECDSA-CHACHA20-POLY1305',
			'ECDHE-RSA-CHACHA20-POLY1305',
			'DHE-RSA-AES128-GCM-SHA256',
			'DHE-RSA-AES256-GCM-SHA384'
		].join(':'),
		honorCipherOrder: true
	});

	httpsServer.listen({ port: listenPort, host: listenHost }, () =>
		logger.debug('httpsServer.listen() [port: %s]', listenPort));

	const socketServer = new IOServer(httpsServer, {
		cors: { origin: [ '*' ] },
		cookie: false
	});

	socketServer.on('connection', (socket) => {
		logger.debug(
			'socket connection [socketId: %s]',
			socket.id
		);

		const { secret: connectionSecret } = socket.handshake.query;

		if (connectionSecret !== secret) {
			logger.error(
				'invalid secret [socketId: %s]',
				socket.id
			);

			return socket.disconnect(true);
		}

		const roomServerConnection = new RoomServerConnection({
			connection: new SocketIOConnection(socket)
		});

		roomServerConnections.set(socket.id, roomServerConnection);
		roomServerConnection.once('close', () =>
			roomServerConnections.delete(socket.id));

		const roomServer = new RoomServer({
			mediaService,
			roomServerConnection
		});

		roomServers.set(socket.id, roomServer);
		roomServer.once('close', () => roomServers.delete(socket.id));
	});

	const close = () => {
		logger.debug('close()');

		roomServerConnections.forEach((roomServerConnection) =>
			roomServerConnection.close());
		roomServers.forEach((roomServer) => roomServer.close());
		mediaService.close();
		httpsServer.close();

		process.exit(0);
	};

	process.once('SIGINT', close);
	process.once('SIGQUIT', close);
	process.once('SIGTERM', close);

	logger.debug('Started!');
})();