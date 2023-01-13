import { Producer } from 'mediasoup/node/lib/Producer';
import { Transport } from 'mediasoup/node/lib/Transport';

export default class RouterMock {
	appData = {
		pipeTransports: new Map(),
		pipeConsumers: new Map(),
		producers: new Map(),
		pipeProducers: new Map()
	};
	constructor(producer?: Producer, transport?: Transport) {
		if (producer) {
			this.appData.producers.set(producer.id, producer);
			this.appData.pipeProducers.set(producer.id, producer);
		}
		if (transport) {
			this.appData.pipeTransports.set(transport.id, transport);
		}
	}

	close = jest.fn();
}