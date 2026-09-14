import EventEmitter from 'events';
import { tmpdir } from 'os';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createProducerMiddleware } from '../../../../src/middlewares/producerMiddleware';
import { ObserverService } from '../../../../src/ObserverService';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import TransportMock from '../../../../__mocks__/TransportMock';

const next = jest.fn();

/** A produceData request for the samples channel, wired to a router with a spy on createDirectTransport. */
const setup = (observerService: ObserverService) => {
	const dataProducer = { id: 'dp-1', appData: {}, observer: new EventEmitter(), close: jest.fn() };
	const dataConsumer = { id: 'dc-1', on: jest.fn(), off: jest.fn(), observer: { once: jest.fn() } };
	const transport = new TransportMock(undefined, dataProducer) as unknown as Transport;
	const router = new RouterMock(undefined, transport) as unknown as Router & { createDirectTransport: jest.Mock };

	router.createDirectTransport = jest.fn(async () => ({ consumeData: async () => dataConsumer }));

	const roomServer = new RoomServerMock() as unknown as RoomServer;

	roomServer.routers.set('id', router);

	const sut = createProducerMiddleware({ roomServer, observerService } as unknown as MiddlewareOptions);
	const context = {
		message: { method: 'produceData', data: { routerId: 'id', transportId: 'id', label: 'observertc-samples' } },
		response: {} as { id?: string },
		handled: false,
	} as unknown as RoomServerConnectionContext & { response: { id?: string } };

	return { sut, context, router, dataProducer, dataConsumer, addDataConsumer: jest.spyOn(observerService, 'addDataConsumer') };
};

describe('producerMiddleware - observertc-samples data producers', () => {
	test('an unconfigured node creates the data producer like any other and never consumes it', async () => {
		const observerService = new ObserverService({});
		const { sut, context, router, dataProducer, addDataConsumer } = setup(observerService);

		await sut(context, next);

		expect(context.response.id).toBe('dp-1');
		expect(context.handled).toBe(true);
		expect(router.appData.dataProducers.get('dp-1')).toBe(dataProducer);
		expect(router.createDirectTransport).not.toHaveBeenCalled();
		expect(addDataConsumer).not.toHaveBeenCalled();
		observerService.close();
	});

	test('a node with a sample store consumes it through a lazily created direct transport', async () => {
		const observerService = new ObserverService({ samplesStorePath: tmpdir() });
		const { sut, context, router, dataConsumer, addDataConsumer } = setup(observerService);

		await sut(context, next);

		expect(context.response.id).toBe('dp-1');
		expect(router.createDirectTransport).toHaveBeenCalledTimes(1);
		expect(addDataConsumer).toHaveBeenCalledWith(dataConsumer);
		observerService.close();
	});
});
