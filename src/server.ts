process.title = 'edumeet-media-node';

import config from '../config/config.json';
import fs from 'fs';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import { Logger } from './common/logger';
import { SocketIOConnection } from './signaling/SocketIOConnection';
import { interactiveServer } from './interactiveServer';
import MediaService from './MediaService';
import RoomServer from './RoomServer';
import { RoomServerConnection } from './RoomServerConnection';

const logger = new Logger('MediaNode');

(async () => {
	logger.debug('Starting...');

	const roomServerConnections = new Map<string, RoomServerConnection>();
	const roomServers = new Map<string, RoomServer>();

	const mediaService = await MediaService.create().catch((error) => {
		logger.error('MediaService creation failed: %o', error);

		return process.exit(1);
	});

	interactiveServer(mediaService, roomServerConnections, roomServers);

	const httpsServer = https.createServer({
		cert: fs.readFileSync(config.tls.cert),
		key: fs.readFileSync(config.tls.key),
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

	httpsServer.listen({ port: config.listenPort, host: config.listenHost }, () =>
		logger.debug('httpsServer.listen() [port: %s]', config.listenPort));

	const socketServer = new IOServer(httpsServer, {
		cors: { origin: [ '*' ] },
		cookie: false
	});

	socketServer.on('connection', (socket) => {
		logger.debug(
			'socket connection [socketId: %s]',
			socket.id
		);

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