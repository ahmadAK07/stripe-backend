// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require('path');

dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors("*"));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("working")
})


app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'success.html'));
});
app.get('/cancel', (req, res) => {
  res.sendFile(path.join(__dirname, 'cancel.html'));
});
// Route to create a subscription
app.post("/create-subscription", async (req, res) => {
  const { priceId, customerId } = req.body;

  try {
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      customer: customerId,
      success_url: "chrome-extension://ncipbdpfdmlidminmhfbbfeekedigapc/tabs/index.html",
      cancel_url: 'chrome-extension://ncipbdpfdmlidminmhfbbfeekedigapc/tabs/index.html',
    });

    // Send the session URL back to the client
    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

// Route to get subscription data
app.post("/get-subscription", async (req, res) => {
  const { email } = req.body;

  try {
    // Retrieve the customer based on email
    const customers = await stripe.customers.list({
      email: email, 
    });

    let customer;
    if (customers.data.length === 0) {
      // Create a new customer if none exists
      customer = await stripe.customers.create({
        email: email,
      });
    } else {
      customer = customers.data[0];
    }

    // Retrieve subscriptions for the customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
    });

    const subscriptionData = subscriptions.data.length > 0
      ? subscriptions.data[0]
      : { metadata: { isSubscribed: "false", customerId: customer.id } };

    res.json(subscriptionData);
  } catch (error) {
    console.error("Error retrieving subscription:", error);
    res.status(500).json({ error: "Failed to retrieve subscription data" });
  }
});

app.post('/cancel-subscription', async (req, res) => {
  try {
    const { subscriptionId } = req.body;
     console.log("subscription: ", subscriptionId)
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }

    // Simulate API call to cancel the subscription
    const canceledSubscription = await stripe.subscriptions.del(subscriptionId);

    return res.status(200).json({ subscription: canceledSubscription });
  } catch (error) {
    console.error('Error canceling subscription:', error.message);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
