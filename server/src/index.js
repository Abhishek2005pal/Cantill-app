import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';

const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/cantill';

mongoose.connect(mongoUri)
  .then(() => app.listen(port, () => console.log(`Cantill API listening on ${port}`)))
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exitCode = 1;
  });
