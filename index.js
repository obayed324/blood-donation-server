const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");


const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  console.log(req.headers.authorization);

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('decoded in the token', decoded);
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }


}

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
    const userCollection = db.collection('users');
    const donationCollection = db.collection("donationRequests");


    // Create user (on first login)
    app.post('/users', async (req, res) => {
      const user = req.body;
      const exists = await users.findOne({ uid: user.uid });
      if (exists) return res.send(exists);

      const result = await userCollection.insertOne({
        ...user,
        role: 'donor',
        status: 'active',
        createdAt: new Date(),
      });

      res.send(result);
    });


    app.get('/users/uid/:uid', async (req, res) => {
      const user = await userCollection.findOne({ uid: req.params.uid });
      if (!user) return res.status(404).send({ message: 'User not found' });
      res.send(user);
    });


    app.put('/users/profile', async (req, res) => {
      const { id, name, bloodGroup, district, upazila, avatar } = req.body;

      const result = await userCollection.updateOne(
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

    // Donation related API
    app.post("/donation-requests", async (req, res) => {
      try {
        const request = req.body;

        // 1️⃣ Validate required field
        if (!request.requesterUid) {
          return res.status(400).send({ message: "Requester UID missing" });
        }

        // 2️⃣ Check user status from DB
        const user = await userCollection.findOne({ uid: request.requesterUid });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        if (user.status !== "active") {
          return res.status(403).send({
            message: "Blocked users cannot create donation request"
          });
        }

        // 3️⃣ Final donation request object
        const donationRequest = {
          requesterUid: request.requesterUid,
          requesterName: request.requesterName,
          requesterEmail: request.requesterEmail,

          recipientName: request.recipientName,
          recipientDistrict: request.recipientDistrict,
          recipientUpazila: request.recipientUpazila,
          hospitalName: request.hospitalName,
          fullAddress: request.fullAddress,
          bloodGroup: request.bloodGroup,
          donationDate: request.donationDate,
          donationTime: request.donationTime,
          requestMessage: request.requestMessage,

          status: "pending",
          donor: {
            name: null,
            email: null
          },

          createdAt: new Date()
        };

        const result = await donationCollection.insertOne(donationRequest);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error("Donation Request Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/donation-requests",verifyFBToken, async (req, res) => {
      try {
        const { status } = req.query;
        const filter = status ? { status: status } : {};
        const requests = await donationCollection.find(filter).toArray();
        res.send(requests);
      }
      catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Get donation request details (private)
    app.get("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;

      const result = await donationCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!result) {
        return res.status(404).send({ message: "Donation request not found" });
      }

      res.send(result);
    });


    // Confirm donation
    app.patch("/donation-requests/donate/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const { donorName, donorEmail } = req.body;

      const update = {
        $set: {
          status: "inprogress",
          donor: {
            name: donorName,
            email: donorEmail,
          },
        },
      };

      const result = await donationCollection.updateOne(
        { _id: new ObjectId(id) },
        update
      );

      res.send(result);
    });







    console.log('MongoDB Connected');
  }
  finally { }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Blood Donation server is running');
});

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
