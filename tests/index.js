/* eslint-disable */
/** @type {Chai.Assert} */
const assert = chai.assert;
chai.config.truncateThreshold = 0;
/* eslint-enable */

// Nearly all Tests depend on /tasks/resetAll endpoint working,
// if every test is failing, this endpoint is likely failing.

const NOT_AUTH_RESPONSE = { message: 'You are not authorized to use this api.' };
const TASK_SUBMITTED_RESPONSE = { message: 'Your task is submitted! Get to work!' };
const TASK_NOT_FOUND_RESPONSE = { message: 'Could not find that task. Double check your post number.' };
const TASK_REMOVED_RESPONSE = { message: 'Your task has been removed' };

/**
 * Array of current tasks from SSE
 *
 * Stream is never cleaned up
 */
const CURRENT_TASKS = (() => {
  const tasks = [];
  const es = new EventSource('/tasks');
  es.addEventListener('message', ({ data }) => {
    tasks.splice(0, tasks.length, ...JSON.parse(data));
  });

  return tasks;
})();

const helpers = {
  apiKey: '<%= apiKey %>',
  async getFetch(url) {
    const response = await fetch(url);
    const data = await response.json();
    console.log(data);
    return data;
  },
  async addTask(user, task, apiKey) {
    return await this.getFetch(
      `/tasks/createTask?user=${user}&task=${task}&key=${apiKey || this.apiKey}`,
    );
  },
  async finishTask(user, apiKey) {
    return await this.getFetch(
      `/tasks/finishTask?user=${user}&key=${apiKey || this.apiKey}`,
    );
  },
  async deleteTask(user, id, apiKey) {
    return await this.getFetch(
      `/tasks/deleteTask?user=${user}&key=${apiKey || this.apiKey}&id=${id}`,
    );
  },
  async resetAllTasks(user, apiKey) {
    return await this.getFetch(
      `/tasks/resetAll?user=${user}&key=${apiKey || this.apiKey}`,
    )
  }
}

const resetDB = async () => {
	await helpers.resetAllTasks('theDabolical').catch(() => undefined);
}

beforeEach(() => resetDB());

describe('/tasks', () => {
  describe('/', () => {
		it('opens SSE stream', (done) => {
			const es = new EventSource('/tasks');
			es.addEventListener('message', ({ data }) => {
				assert.deepStrictEqual(JSON.parse(data), []);
				es.close();
				done();
			});
		});
		it('is sent updates', (done) => {
			const es = new EventSource('/tasks');
			es.addEventListener('message', ({ data }) => {
				const tasks = JSON.parse(data);
				if (!tasks.length) return;

				assert.deepStrictEqual(tasks.length, 1);

				const task = tasks[0];

				assert.deepStrictEqual(task.task, 'task text');
				assert.deepStrictEqual(task.user, 'username');
				assert.ok(!task.finished);

				es.close();
				done();
			});
      helpers.addTask('username', 'task text')
        .then(payload =>
          assert.deepStrictEqual(payload, TASK_SUBMITTED_RESPONSE)
        )
        .catch(assert.fail);
		});
  });

	describe('/createTask', () => {
		it('creates new task', () =>
      helpers.addTask('username', 'task text')
        .then(payload => assert.deepStrictEqual(payload, TASK_SUBMITTED_RESPONSE))
		);
		it('prevents creation of additional task', async () => {
			await helpers.addTask('username', 'task text');
			return helpers.addTask('username', 'another one')
        .then(payload => assert.deepStrictEqual(payload,  { message: 'You must finish your open task first' }))
		});
		it('requires fields', async () => {
      await helpers.addTask('username', '')
        .then(payload =>
          assert.deepStrictEqual(payload, {
            message: 'Submission was invalid.',
            error: [
              'Task must have a value'
            ]
          })
        );

      await helpers.addTask('', 'text')
        .then(payload =>
          assert.deepStrictEqual(payload, {
            message: 'Submission was invalid.',
            error: [
              'User must have a value'
            ]
          })
        )
      await helpers.addTask('', '')
        .then(payload =>
          assert.deepStrictEqual(payload, {
            message: 'Submission was invalid.',
            error: [
              'User must have a value',
              'Task must have a value'
            ]
          })
        );
		});
	});

	describe('/finishTask', () => {
		it('requires existing task', () =>
      helpers.finishTask('username')
        .then(payload => assert.deepStrictEqual(payload, { message: 'You have no open tasks' }))
		);
		it('finishes task', async () => {
      await helpers.addTask('username', 'task text');
			await helpers.finishTask('username')
        .then(payload => assert.deepStrictEqual(payload, { message: 'Nailed it! Look at you go!' }))
		});
	});

	describe('/deleteTask', () => {
		it('handles invalid task ID', () =>
			helpers.deleteTask('username', '0')
				.then(payload => assert.deepStrictEqual(payload, TASK_NOT_FOUND_RESPONSE))
		);
		it('deletes task', async () => {
      await helpers.addTask('username', 'task text');
			await helpers.deleteTask('username', '1')
				.then(payload => assert.deepStrictEqual(payload, TASK_REMOVED_RESPONSE))
		});
		it('can not delete others tasks', async () => {
      await helpers.addTask('username', 'task text');
      await helpers.deleteTask('other', '1')
        .then(payload => assert.deepStrictEqual(payload, { message: 'Unauthorized. You can only delete your own tasks.' }))
		});
		it('admins can delete any task', async () => {
        await helpers.addTask('username', 'task text');
        await helpers.deleteTask('thedabolical', '1')
          .then(payload => assert.deepStrictEqual(payload, TASK_REMOVED_RESPONSE))
		});

		it('deletes last unfinished task when not provided ID', async () => {
      await helpers.addTask('username', 'task text');
      await helpers.finishTask('username')

      await helpers.addTask('username', 'task text');
      await helpers.deleteTask('username')
        .then(payload => assert.deepStrictEqual(payload, TASK_REMOVED_RESPONSE))

      await helpers.deleteTask('username')
        .then(payload => assert.deepStrictEqual(payload, TASK_NOT_FOUND_RESPONSE))
		});
	});

	describe('/resetAll', () => {
		it('not usable by other users', () =>
      helpers.resetAllTasks('username')
        .then(payload => assert.deepStrictEqual(payload, { message: 'Only the stream owner can delete all tasks.' }))
		);
		it('works', async () => {
      await helpers.addTask('username', 'task text')
			await helpers.resetAllTasks('theDabolical')
        .then(payload => assert.deepStrictEqual(payload, { message: 'All tasks reset.' }))
      assert.deepStrictEqual(CURRENT_TASKS, []);
		});
	});
});

describe('API KEY', () => {
  if (!helpers.apiKey) {
    return it.skip('unable to test wihout API_KEY being set')
  }
  it('blocks invalid prefix', async () => {
    await helpers.addTask('username', 'task text', 'wrong key')
      .then(payload => assert.deepStrictEqual(payload, NOT_AUTH_RESPONSE));
  });
  it('accept correct prefix', async () => {
    await helpers.addTask('username', 'task text', helpers.apiKey + 'random text after')
      .then(payload => assert.deepStrictEqual(payload, TASK_SUBMITTED_RESPONSE));
  });
});