import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import { seed } from './seed.js';
import { Item, Policy } from './models/index.js';

const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/cantill';

mongoose.connect(mongoUri)
  .then(async () => {
    const [itemCount, policyCount] = await Promise.all([Item.countDocuments(), Policy.countDocuments()]);
    if (itemCount === 0 || policyCount === 0) {
      console.log('MongoDB is missing seed data; importing the kit automatically...');
      try {
        await seed();
        console.log('Automatic seed completed.');
      } catch (seedError) {
        console.error('Automatic seed failed; app will remain live for diagnostics:', seedError.message);
      }
    }
    app.listen(port, () => console.log(`Cantill API listening on ${port}`));
  })
  .catch((error) => {
    console.error('MongoDB connection or seed failed:', error.message);
    process.exitCode = 1;
  });
