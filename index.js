const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);


const port = process.env.PORT || 3000;


const crypto = require("crypto");

const admin = require("firebase-admin");
//const serviceAccount = require("./serviceAccountKey.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}










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
    const paymentCollection = db.collection('payments');

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }

      next();
    }




    // Create user (on first login)
    app.post('/users', async (req, res) => {
      const user = req.body;
      const exists = await userCollection.findOne({ uid: user.uid });
      if (exists) return res.send(exists);

      const result = await userCollection.insertOne({
        ...user,
        role: 'donor',
        status: 'active',
        createdAt: new Date(),
      });

      res.send(result);
    });

    //for fetch profile information 
    app.get('/users/uid/:uid', verifyFBToken, async (req, res) => {
      const user = await userCollection.findOne({ uid: req.params.uid });
      if (!user) return res.status(404).send({ message: 'User not found' });
      res.send(user);
    });

    //for role based login 
    app.get("/users/role/:uid", verifyFBToken, async (req, res) => {
      try {
        const user = await userCollection.findOne({ uid: req.params.uid });

        if (!user) {
          return res.status(404).send({ role: "user" });
        }

        res.send({ role: user.role || "user" });
      } catch (err) {
        res.status(500).send({ message: "Internal Server Error" });
      }
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
    app.post("/donation-requests", verifyFBToken, async (req, res) => {
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
          return res.status(400).send({
            message: "Blocked users cannot create donation request!! please contact with admin"
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

    app.get("/donation-requests", async (req, res) => {
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

    // Get donor dashboard data (last 3 requests)
    app.get("/dashboard/my-donation-requests/:uid", verifyFBToken, async (req, res) => {
      const { uid } = req.params;

      try {
        const requests = await donationCollection
          .find({ requesterUid: uid })
          .sort({ createdAt: -1 }) // recent first
          .limit(3)
          .toArray();

        res.send(requests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Update a donation request by ID
    app.put("/donation-requests/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const data = { ...req.body };
        delete data._id; // prevent _id modification

        const result = await donationCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: data }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Donation request not found" });
        }

        res.send({ message: "Donation request updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });


    app.delete("/donation-requests/:id", verifyFBToken, async (req, res) => {
      const { ObjectId } = require("mongodb");
      const { id } = req.params;

      if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

      try {
        const result = await donationCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).send({ message: "Not found" });
        res.send({ message: "Deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });


    app.patch("/donation-requests/status/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      // allowed status values
      const allowedStatus = ["done", "canceled"];

      if (!allowedStatus.includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      try {
        const result = await donationCollection.updateOne(
          { _id: new ObjectId(id), status: "inprogress" },
          {
            $set: { status },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            message: "Donation request not found or status not in progress",
          });
        }

        res.send({
          message: `Donation request marked as ${status}`,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //donor search API
    app.get("/donors/search", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;

        const query = {
          bloodGroup,
          district,
          upazila,
          status: "active",
        };

        const donors = await userCollection.find(query).toArray();
        res.send(donors);
      } catch (error) {
        res.status(500).send({ message: "Failed to search donors" });
      }
    });

    //payment related API

    app.post('/payment-checkout-session', verifyFBToken, async (req, res) => {
      try {
        const { amount, donorEmail, donorName, role } = req.body;

        const donationAmount = parseInt(amount) * 100; // Stripe uses smallest unit

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'bdt',
                unit_amount: donationAmount,
                product_data: {
                  name: 'Blood Donation Funding',
                  description: 'Supporting blood donation and emergency patients',
                },
              },
              quantity: 1,
            },
          ],
          mode: 'payment',

          metadata: {
            donorName,
            role,
            purpose: 'blood-donation-funding',
          },

          customer_email: donorEmail,

          success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        res.status(500).send({ message: 'Payment session failed' });
      }
    });

    app.patch('/payment-success', verifyFBToken, async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;

        // prevent duplicate payment save
        const paymentExist = await paymentCollection.findOne({
          transactionId,
        });

        if (paymentExist) {
          return res.send({
            message: 'already exists',
            transactionId,
          });
        }

        if (session.payment_status === 'paid') {
          const donation = {
            amount: session.amount_total / 100,
            currency: session.currency,
            donorEmail: session.customer_email,
            donorName: session.metadata.donorName,
            role: session.metadata.role,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            purpose: 'blood-donation',
            paidAt: new Date(),
          };

          const result = await paymentCollection.insertOne(donation);

          return res.send({
            success: true,
            transactionId,
            donation: result,
          });
        }

        res.send({ success: false });
      } catch (error) {
        res.status(500).send({ message: 'Payment verification failed' });
      }
    });

    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.donorEmail = email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' });
        }
      }

      const payments = await paymentCollection
        .find(query)
        .sort({ paidAt: -1 })
        .toArray();

      res.send(payments);
    });




    app.get('/admin/stats', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        // 1️⃣ Total Users (Donors)
        const totalUsers = await userCollection.countDocuments();

        // 2️⃣ Total Blood Donation Requests
        const totalRequests = await donationCollection.countDocuments();

        // 3️⃣ Total Funding (sum of all payments)
        const fundingResult = await paymentCollection.aggregate([
          {
            $group: {
              _id: null,
              totalFunding: { $sum: "$amount" },
            },
          },
        ]).toArray();

        const totalFunding = fundingResult[0]?.totalFunding || 0;

        res.send({
          totalUsers,
          totalFunding,
          totalRequests,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load admin statistics" });
      }
    });

    //for all donation request
    app.get("/admin/donation-requests", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await donationCollection
        .find({})
        .sort({ donationDate: -1 })
        .toArray();

      res.send(result);
    });

    app.get("/admin/users", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const users = await userCollection.find({}).toArray();
        res.send(users);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.patch("/admin/users/:id/status", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { status } = req.body; // "active" or "blocked"
        const userId = req.params.id;

        await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { status } }
        );

        res.send({ success: true, status });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.patch("/admin/users/:id/role", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { role } = req.body; // "volunteer" or "admin"
        const userId = req.params.id;

        await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role } }
        );

        res.send({ success: true, role });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });


    // Volunteer Dashboard Stats
    app.get("/volunteer/stats", verifyFBToken, async (req, res) => {
      try {
        // Count all requests
        const totalRequests = await donationCollection.countDocuments();

        const pendingRequests = await donationCollection.countDocuments({
          status: "pending",
        });

        const completedRequests = await donationCollection.countDocuments({
          status: "done",
        });

        res.send({
          totalRequests,
          pendingRequests,
          completedRequests,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });



    // Update donation status - only allowed field: status
    app.patch("/donation-requests/:id/status", verifyFBToken, async (req, res) => {
      try {
        const donationId = req.params.id;
        const { status } = req.body;

        if (!status) {
          return res.status(400).send({ message: "Status is required" });
        }

        // Update only the status field
        const result = await donationCollection.updateOne(
          { _id: new ObjectId(donationId) },
          { $set: { status } }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Donation request not found or status unchanged" });
        }

        res.send({ success: true, message: "Status updated", status });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update status" });
      }
    }
    );

    app.get("/volunteer/donation-requests", verifyFBToken, async (req, res) => {
      const result = await donationCollection
        .find({})
        .sort({
          createdAt
            : -1
        })
        .toArray();

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
