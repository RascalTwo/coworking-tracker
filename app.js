const express = require('express');
const logger = require('morgan');
const cors = require('cors');
const port = process.env.PORT || 3000;

const app = express();

app.use(cors());

app.use(logger('dev'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.route('/').get((req, res) => res.render('tasks'));

app.use((req, res, next) => {
  req.query.key === process.env.API_KEY
    ? res.json({ message: 'You are not authorized to use this api.' })
    : next();
});

const tasksRoute = require('./routes/tasks');
app.use('/tasks', tasksRoute);

app.use((err, _req, res, _next) => {
  const errors = err.validationErrors || err.errors || ['No further information'];
  res.status(200).json({
    message: err.message,
    error: errors,
  });
});

app.listen(port, () => console.log(`Running on port ${port}`));
