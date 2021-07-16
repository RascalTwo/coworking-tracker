const assert = require('assert');

const supertest = require('supertest');
const superagent = require('superagent');
const express = require('express');
const EventSource = require('eventsource')

const NOT_AUTH_RESPONSE = { message: 'You are not authorized to use this api.' };
const TASK_SUBMITTED_RESPONSE = { message: 'Your task is submitted! Get to work!' };

let app = null;
let Task = null;
before(() => {
	Task = require('../model/index.js').Task;
	const router = require('../routes/tasks.js');
	app = express();
	app.use('/tasks', router);
});

const resetDB = async () => {
	await Task.destroy({ where: {}, truncate: true }).catch(() => undefined);
}

beforeEach(() => resetDB());
describe('/tasks', () => {

	describe('/', () => {
		it('opens SSE stream', (done) => {
			const server = app.listen(1234);
			const es = new EventSource('http://localhost:1234/tasks/');
			es.addEventListener('message', ({ data }) => {
				assert.deepStrictEqual(JSON.parse(data), []);
				server.close()
				es.close();
				done();
			});
		});
		it('is sent updates', (done) => {
			const server = app.listen(1234);
			const es = new EventSource('http://localhost:1234/tasks/');
			es.addEventListener('message', ({ data }) => {
				const tasks = JSON.parse(data);
				if (!tasks.length) return;

				assert.deepStrictEqual(tasks.length, 1);

				const task = tasks[0];

				assert.deepStrictEqual(task.task, 'task text');
				assert.deepStrictEqual(task.user, 'username');
				assert.ok(!task.finished);

				es.close();
				server.close();
				done();
			});
			superagent
				.get('http://localhost:1234/tasks/createTask?user=username&task=task%20text')
				.end((err, res) => {
					if (err) throw err;
					assert.deepStrictEqual(res.body, TASK_SUBMITTED_RESPONSE)
				});
		});
	});

	describe('/createTask', () => {
		it('creates new task', () =>
			supertest(app)
				.get('/tasks/createTask?user=username&task=task%20text')
				.expect(201, TASK_SUBMITTED_RESPONSE)
		);
		it('prevents creation of additional task', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=username&task=task%20text')
			await supertest(app)
				.get('/tasks/createTask?user=username&task=another%20one')
				.expect(200, { message: 'You must finish your open task first' })
		});
		it('requires fields', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=username&task=')
				.expect(res => {
					assert.deepStrictEqual(res.statusCode, 400);
					assert.ok(res.text.includes('Submission was invalid.'))
				});
			await supertest(app)
				.get('/tasks/createTask?user=&task=text')
				.expect(res => {
					assert.deepStrictEqual(res.statusCode, 400);
					assert.ok(res.text.includes('Submission was invalid.'))
				});
			await supertest(app)
				.get('/tasks/createTask?user=')
				.expect(res => {
					assert.deepStrictEqual(res.statusCode, 400);
					assert.ok(res.text.includes('Submission was invalid.'))
				});
			await supertest(app)
				.get('/tasks/createTask?text=')
				.expect(res => {
					assert.deepStrictEqual(res.statusCode, 400);
					assert.ok(res.text.includes('Submission was invalid.'))
				});
			await supertest(app)
				.get('/tasks/createTask')
				.expect(res => {
					assert.deepStrictEqual(res.statusCode, 400);
					assert.ok(res.text.includes('Submission was invalid.'))
				});
		});
	});

	describe('/finishTask', () => {
		it('requires existing task', () =>
			supertest(app)
				.get('/tasks/finishTask?user=username')
				.expect(200, { message: 'You have no open tasks' })
		);
		it('finishes task', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=username&task=task%20text')
			await supertest(app)
				.get('/tasks/finishTask?user=username')
				.expect(201, { message: 'Nailed it! Look at you go!' })
		});
	});

	describe('/deleteTask', () => {
		it('handles invalid task ID', () =>
			supertest(app)
				.get('/tasks/deleteTask?user=username&id=0')
				.expect(200, { message: 'Could not find that task. Double check your post number.' })
		);
		it('deletes task', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=username&task=deletion-text')
			const task = await Task.findOne({ where: { task: 'deletion-text' }})
			await supertest(app)
				.get('/tasks/deleteTask?user=username&id=' + task.id)
				.expect(201, { message: 'Your task has been removed' })
		});
		it('can not delete others tasks', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=first&task=deletion-text')
			const task = await Task.findOne({ where: { task: 'deletion-text' }})
			await supertest(app)
				.get('/tasks/deleteTask?user=second&id=' + task.id)
				.expect(200, { message: 'Unauthorized. You can only delete your own tasks.' })
		});
		it('admins can delete any task', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=first&task=deletion-text')
			const task = await Task.findOne({ where: { task: 'deletion-text' }})
			await supertest(app)
				.get('/tasks/deleteTask?user=thedabolical&id=' + task.id)
				.expect(201, { message: 'Your task has been removed' })
		});

		it('deletes last unfinished task when not provided ID', async () => {
			// Create and finish task
			await supertest(app)
				.get('/tasks/createTask?user=first&task=finishing-text')
			await supertest(app)
				.get('/tasks/finishTask?user=username')

			// Create and delete task without ID
			await supertest(app)
				.get('/tasks/createTask?user=first&task=delete-without-id')
			await supertest(app)
				.get('/tasks/deleteTask?user=first')
				.expect(201, { message: 'Your task has been removed' })

			// Try and delete already finished task without ID
			await supertest(app)
				.get('/tasks/deleteTask?user=first')
				.expect(200, { message: 'Could not find that task. Double check your post number.' })
		});
	});

	describe('/resetAll', () => {
		it('not usable by other users', () =>
			supertest(app)
				.get('/tasks/resetAll?user=username')
				.expect(200, { message: 'Only the stream owner can delete all tasks.' })
		);
		it('works', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=username&task=deletion-text')
			await supertest(app)
				.get('/tasks/resetAll?user=theDabolical')
				.expect(201, { message: 'All tasks reset.' })
			assert.deepStrictEqual(await Task.findAll({}), []);
		});
		it('can not delete others tasks', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=first&task=deletion-text')
			const task = await Task.findOne({ where: { task: 'deletion-text' }})
			await supertest(app)
				.get('/tasks/deleteTask?user=second&id=' + task.id)
				.expect(200, { message: 'Unauthorized. You can only delete your own tasks.' })
		});
		it('admins can delete any task', async () => {
			await supertest(app)
				.get('/tasks/createTask?user=first&task=deletion-text')
			const task = await Task.findOne({ where: { task: 'deletion-text' }})
			await supertest(app)
				.get('/tasks/deleteTask?user=thedabolical&id=' + task.id)
				.expect(201, { message: 'Your task has been removed' })
		});
	});
});

describe('API_KEY', () => {
	before(() => {
		delete process.env.API_KEY;
	});

	after(() => {
		delete process.env.API_KEY;
	});

	it('is optional', () =>
		supertest(app)
			.get('/tasks/createTask?user=user&task=task')
			.expect(TASK_SUBMITTED_RESPONSE)
	);
	it('prevents usage when defined', async () => {
		process.env.API_KEY = 'my super key'
		await supertest(app)
			.get('/tasks/createTask?user=user&task=task')
			.expect(NOT_AUTH_RESPONSE);
		delete process.env.API_KEY;
	});
	it('must match as prefix when defined', async () => {
		process.env.API_KEY = 'my super key';
		// completly wrong
		await supertest(app)
			.get('/tasks/createTask?key=abc&user=user&task=task')
			.expect(NOT_AUTH_RESPONSE);
		// exactly
		await supertest(app)
			.get('/tasks/createTask?key=my%20super%20key&user=user&task=task')
			.expect(TASK_SUBMITTED_RESPONSE);
		await Task.destroy({ truncate: true });
		// too long - still matches as prefix is the correct key
		await supertest(app)
			.get('/tasks/createTask?key=my%20super%20keyextra&user=user&task=task')
			.expect(TASK_SUBMITTED_RESPONSE);
		// too short
		await supertest(app)
			.get('/tasks/createTask?key=my%20super&user=user&task=task')
			.expect(NOT_AUTH_RESPONSE);
	});
});
