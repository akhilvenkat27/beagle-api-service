const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const { rateLimitApi } = require('./middleware/rateLimit');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api', rateLimitApi);

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/project-templates', require('./routes/projectTemplateRoutes'));
app.use('/api/intake', require('./routes/intakeRoutes'));
app.use('/api/audit', require('./routes/auditRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/financial', require('./routes/financialRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/cost-rates', require('./routes/costRateRoutes'));
app.use('/api/darwinbox', require('./routes/darwinboxRoutes'));
app.use('/api/modules', require('./routes/moduleRoutes'));
app.use('/api/workstreams', require('./routes/workstreamRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/comments', require('./routes/commentRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/cr', require('./routes/crRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/governance', require('./routes/governanceRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/portfolio', require('./routes/portfolioRoutes'));
app.use('/api/execution', require('./routes/executionRoutes'));
app.use('/api/resources', require('./routes/resourceRoutes'));
app.use('/api/matrix', require('./routes/matrixRoutes'));

const intakeController = require('./controllers/intakeController');

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Beagle API is running' });
});

// Public HubSpot webhook endpoints. These only create pending admin intake rows.
app.post('/hubspot/webhook', intakeController.hubspotDealWebhook);
app.post('/hubspot/fetchDealData', intakeController.hubspotDealWebhook);

// 404 — JSON API
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler (must be last middleware; 4-arg signature)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid ID format' });
  }
  res.status(500).json({ message: 'Internal server error' });
});

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/beagle';

const { runTier1ReviewScheduler } = require('./services/reviewScheduler');
const { runTaskDelayEscalation } = require('./services/taskDelayEscalationService');
const { runScheduledReportsJob } = require('./controllers/reportController');

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    try {
      await runTier1ReviewScheduler();
      await runTaskDelayEscalation();
      await runScheduledReportsJob();
    } catch (e) {
      console.error('[Schedulers] initial run:', e.message);
    }
    setInterval(
      () => {
        runTier1ReviewScheduler().catch((err) =>
          console.error('[Governance] daily review scheduler:', err.message)
        );
      },
      24 * 60 * 60 * 1000
    );
    setInterval(
      () => {
        runScheduledReportsJob().catch((err) =>
          console.error('[Reports] scheduled run failed:', err.message)
        );
      },
      60 * 60 * 1000
    );
    setInterval(
      () => {
        runTaskDelayEscalation().catch((err) =>
          console.error('[TaskDelay] escalation scheduler:', err.message)
        );
      },
      24 * 60 * 60 * 1000
    );
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
