const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ayh9j9o.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db('blood-donation');
    const users = db.collection('users');

    // Create user (on first login)
    app.post('/users', async (req, res) => {
      const user = req.body;
      const exists = await users.findOne({ uid: user.uid });
      if (exists) return res.send(exists);

      const result = await users.insertOne({
        ...user,
        role: 'donor',
        status: 'active',
        createdAt: new Date(),
      });

      res.send(result);
    });

    
    app.get('/users/uid/:uid', async (req, res) => {
      const user = await users.findOne({ uid: req.params.uid });
      if (!user) return res.status(404).send({ message: 'User not found' });
      res.send(user);
    });

    
    app.put('/users/profile', async (req, res) => {
      const { id, name, bloodGroup, district, upazila, avatar } = req.body;

      const result = await users.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            name,
            bloodGroup,
            district, // stored as ID (e.g. "8")
            upazila,
            avatar,
            updatedAt: new Date(),
          },
        }
      );

      res.send({ success: true, result });
    });

    

    console.log('MongoDB Connected');
  } 
  finally {}
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server running');
});

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
