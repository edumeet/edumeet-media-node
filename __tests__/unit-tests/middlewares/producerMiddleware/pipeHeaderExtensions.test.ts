import EventEmitter from 'events';
import { Router } from 'mediasoup/node/lib/Router';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createProducerMiddleware } from '../../../../src/middlewares/producerMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';

const next = jest.fn();

type HeaderExtension = { uri: string, id: number };
type ProduceOptions = { rtpParameters: { headerExtensions?: HeaderExtension[] } };

const setup = (headerExtensions?: HeaderExtension[]) => {
	const produce = jest.fn(async (options: ProduceOptions) => ({
		id: 'pp-1',
		options,
		appData: {},
		observer: new EventEmitter(),
	}));
	const router = new RouterMock() as unknown as Router;

	(router.appData as unknown as { pipeTransports: Map<string, unknown> }).pipeTransports.set('pt-1', { id: 'pt-1', produce });

	const roomServer = new RoomServerMock() as unknown as RoomServer;

	roomServer.routers.set('r-1', router);

	const sut = createProducerMiddleware({ roomServer } as unknown as MiddlewareOptions);
	const context = {
		message: {
			method: 'createPipeProducer',
			data: {
				routerId: 'r-1',
				pipeTransportId: 'pt-1',
				producerId: 'p-1',
				kind: 'video',
				rtpParameters: { codecs: [], encodings: [ { ssrc: 1 } ], headerExtensions },
				paused: false,
			},
		},
		response: {} as { id?: string },
		handled: false,
	} as unknown as RoomServerConnectionContext & { response: { id?: string } };

	return { sut, context, produce };
};

describe('producerMiddleware - pipe producers from another mediasoup version', () => {
	test('drops header extensions this mediasoup does not support', async () => {
		const { sut, context, produce } = setup([
			{ uri: 'urn:ietf:params:rtp-hdrext:sdes:mid', id: 1 },
			{ uri: 'urn:ietf:params:rtp-hdrext:toffset', id: 2 },
			{ uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 3 },
		]);

		await sut(context, next);

		expect(context.response.id).toBe('pp-1');
		expect(produce.mock.calls[0][0].rtpParameters.headerExtensions).toEqual([
			{ uri: 'urn:ietf:params:rtp-hdrext:sdes:mid', id: 1 },
			{ uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 3 },
		]);
	});

	test('leaves parameters without header extensions as they are', async () => {
		const { sut, context, produce } = setup(undefined);

		await sut(context, next);

		expect(produce.mock.calls[0][0].rtpParameters.headerExtensions).toBeUndefined();
	});
});
