const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const port = process.env.PORT || 3000

//middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ayh9j9o.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('blood-donation')
    const userCollection = db.collection('users');

    // Add this in your backend
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
      
        // Check if user already exists
        const existingUser = await userCollection.findOne({ email: user.email });
        if (existingUser) {
          return res.status(400).send({ message: 'User already exists' });
        }

        // Add default fields
        user.role = 'donor';
        user.status = 'active';
        user.createdAt = new Date();

        const result = await userCollection.insertOne(user);
        res.send(result);
      } 
      catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  }
  finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Blood Donation Server Is loading!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
