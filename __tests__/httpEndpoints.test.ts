import { IncomingMessage, ServerResponse } from 'http';
import { createHttpEndpoints } from '../src/httpEndpoints';
import MediaService from '../src/MediaService';
import MediaServiceMock from '../__mocks__/MediaServiceMock';
import os, { CpuInfo } from 'os';

test('Health should return 200', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const endpoints = createHttpEndpoints(mockMediaService);

	const req = {
		method: 'GET',
		url: '/health'
	} as unknown as IncomingMessage;
    
	const res = new ServerResponse(req);

	endpoints(req, res);

	expect(res.statusCode).toBe(200);
	expect(res.statusMessage).toBe('OK');

	/**
	 * We write headers explicitly to the response stream, using writeHead().
	 * Thus, the response headers will not be available for testing.
     */
	expect(res.getHeaders()).toEqual({});
});

test('Metrics should call getMetrics() on MediaService', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const spyGetMetrics = jest.spyOn(mockMediaService, 'getMetrics');
	const endpoints = createHttpEndpoints(mockMediaService);

	const req = {
		method: 'GET',
		url: '/metrics'
	} as unknown as IncomingMessage;
    
	const res = new ServerResponse(req);

	endpoints(req, res);

	expect(spyGetMetrics).toHaveBeenCalled();
	expect(res.statusCode).toBe(200);
	expect(res.statusMessage).toBe('OK');
	expect(res.getHeaders()).toEqual({});
});

test('Load should call loadavg and cpus', () => {

	const spyLoadavg = jest.spyOn(os, 'loadavg').mockReturnValue([ 0.5 ]);
	const fakeCpu = {} as unknown as CpuInfo;
	const spyCpus = jest.spyOn(os, 'cpus').mockReturnValue([ fakeCpu ]);
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const endpoints = createHttpEndpoints(mockMediaService);

	const req = {
		method: 'GET',
		url: '/load'
	} as unknown as IncomingMessage;
    
	const res = new ServerResponse(req);

	endpoints(req, res);

	expect(spyLoadavg).toHaveBeenCalled();
	expect(spyCpus).toHaveBeenCalled();
	expect(res.statusCode).toBe(200);
	expect(res.statusMessage).toBe('OK');
	expect(res.getHeaders()).toEqual({});
});

test('Non-existent url should return 404', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const endpoints = createHttpEndpoints(mockMediaService);

	const req = {
		method: 'GET',
		url: '/non-existing-url'
	} as unknown as IncomingMessage;
    
	const res = new ServerResponse(req);

	endpoints(req, res);

	expect(res.statusCode).toBe(404);
	expect(res.statusMessage).toBe('Not Found');
});

test.each([ 'POST', 'PATCH', 'PUT', 'OPTIONS', 'HEAD', 'DELETE' ])('Wrong methods should return 405', (methodToTest) => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const endpoints = createHttpEndpoints(mockMediaService);

	const req = {
		method: methodToTest,
		url: '/non-existing-url'
	} as unknown as IncomingMessage;
    
	const res = new ServerResponse(req);

	endpoints(req, res);

	expect(res.statusCode).toBe(405);
	expect(res.statusMessage).toBe('Method Not Allowed');
});
