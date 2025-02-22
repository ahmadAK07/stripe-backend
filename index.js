const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const cloudinary = require("cloudinary").v2;
const Stripe = require("stripe");

// Load environment variables
dotenv.config();
console.log("SUCCESS_URL: ", process.env.SUCCESS_URL);
console.log("webhook: ", process.env.WEBHOOK_SECRET);
console.log("sk stripe: ", process.env.STRIPE_SK);
const PORT = process.env.PORT || 4000;
const stripe = Stripe(process.env.STRIPE_SK);

const app = express();
app.use(cors());
app.use(express.json());
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
// This is your Stripe CLI webhook secret for testing your endpoint locally.
const endpointSecret = process.env.WEBHOOK_SECRET;
app.post('/delete-video', async (req, res) => {
    try {
        const { videoId } = req.body; // Get the ID from request body
        if (!videoId) {
            return res.status(400).json({ error: "Missing video ID" });
        }
        
        const result = await VideoModel.findByIdAndDelete(videoId);
        if (!result) {
            return res.status(404).json({ error: "Video not found" });
        }
        
        res.json({ message: "Video deleted successfully" });
    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    switch (event.type) {
        case "invoice.payment_failed": {
            const invoiceFailed = event.data.object;
            const customerId = invoiceFailed.customer;

            // Update the customer's metadata to default values
            const defaultMetadata = {
                customerId,
                isSubscribed: 'false',
                activePlan: "free",
                subscriptionId: null,
            };

            await stripe.customers.update(customerId, {
                metadata: defaultMetadata,
            });

            break;
        }
        case "invoice.payment_succeeded": {
            const invoiceSucceeded = event.data.object;
            const subscriptionId = invoiceSucceeded.subscription;
            const customerId = invoiceSucceeded.customer;

            // Update the customer's metadata for the monthly plan
            const updatedMetadata = {
                customerId,
                isSubscribed: 'true',
                activePlan: "Monthly",
                subscriptionId,
            };

            await stripe.customers.update(customerId, {
                metadata: updatedMetadata,
            });

            break;
        }
        case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const customerId = subscription.customer;

            // Update the customer's metadata to default values
            const defaultMetadata = {
                customerId,
                isSubscribed: 'false',
                activePlan: "free",
                subscriptionId: null,
            };

            await stripe.customers.update(customerId, {
                metadata: defaultMetadata,
            });

            break;
        }
        case "customer.subscription.updated": {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            const subscriptionStatus = subscription.status;
            const latestInvoice = subscription.latest_invoice;
            const paymentStatus = latestInvoice ? latestInvoice.payment_intent.status : null;

            // Check if the subscription is active but payment hasn't been made
            if (subscriptionStatus === 'active' && paymentStatus !== 'succeeded') {
                // Update the customer's subscription to inactive
                await stripe.subscriptions.update(subscription.id, {
                    cancel_at_period_end: true, // Or set to 'inactive' based on your logic
                });

                // Optionally, update the customer's metadata or perform other actions
                const defaultMetadata = {
                    customerId,
                    isSubscribed: 'false',
                    activePlan: "free",
                    subscriptionId: null,
                };

                await stripe.customers.update(customerId, {
                    metadata: defaultMetadata,
                });
            }

            break;
        }
        default: {
            // Return a 200 response to acknowledge receipt of the event
            response.status(200).send('Received');
        }
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
});



async function handleCustomerSubscription(email, priceId) {
    try {
        const customers = await stripe.customers.list({ email, limit: 1 });

        let customer;
        if (customers.data.length > 0) {
            customer = customers.data[0];
        } else {
            customer = await stripe.customers.create({ email });
        }

        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'all',
            limit: 1
        });
        console.log("subscription: ", subscriptions);
        console.log("customer id: ", customer.id);
       console.log("subscriptions: ", subscriptions);
        const defaultMetadata = {
            customerId: customer.id,
            isSubscribed: 'false',
            activePlan: "free",
            subscriptionId: null,
        };

        if (Object.keys(customer.metadata).length === 0) {
            await stripe.customers.update(customer.id, {
                metadata: defaultMetadata,
            });
        }

        if (subscriptions.data.length > 0) {
            return { subscription: true, metadata: customer.metadata, subscriptionStats: subscriptions.data[0].status, subscriptionId: subscriptions.data[0].id };
        } else {
            return { subscription: false, metadata: customer.metadata, subscriptionStats: "inactive" };;
        }
    } catch (error) {
        console.error('Error handling customer subscription:', error);
        throw e, priceIdrror;
    }
}

async function createSubscriptionWithTrial(customerId, priceId) {
    try {
        // Check if the customer already has an active or trialing subscription
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all', // Fetch all subscriptions regardless of status
            limit: 1,
        });

        // If the customer already has an active or trialing subscription, return it
        if (subscriptions.data.length > 0) {
            const activeOrTrialingSubscription = subscriptions.data.find(
                (sub) => sub.status === 'active' || sub.status === 'trialing'
            );

            if (activeOrTrialingSubscription) {
                return {
                    success: false,
                    message: 'User already has an active or trialing subscription.',
                };
            }
        }

        // If no active or trialing subscription exists, create a new subscription with a trial period
        // const subscription = await stripe.subscriptions.create({
        //     customer: customerId,
        //     items: [{ price: priceId }],
        //     trial_period_days: 30, // Add a 30-day free trial
        // });

        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: priceId }],
            trial_end: Math.floor(Date.now() / 1000) + (60 * 2), // Set trial end to 1 minute from now
            trial_settings: {
                end_behavior: {
                    missing_payment_method: 'cancel'
                }
            }
        });
        

        return {
            success: true,
            subscription,
        };
    } catch (error) {
        console.error('Error creating subscription with trial:', error);
        return {
            success: false,
            message: error.message,
        };
    }
}



async function createCheckoutSession(customerId, priceId, couponId) {
    console.log("coupon code: ", couponId);
    console.log("price Id: ", priceId);
    try {
        let session;
         if(couponId?.length > 0){
            session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'subscription',
                customer: customerId,
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                subscription_data: {
                    trial_period_days: 3, // Set the trial period in days
                  },
                discounts: [{ coupon: couponId.trim() }] ,
                success_url: process.env.SUCCESS_URL,
                cancel_url: process.env.CANCEL_URL,
            });
         }else{
            session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'subscription',
                customer: customerId,
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                subscription_data: {
                    trial_period_days: 3, // Set the trial period in days
                  },
                success_url: process.env.SUCCESS_URL,
                cancel_url: process.env.CANCEL_URL,
            });
         }

        return {
            success: true,
            url: session.url,
        };
    } catch (error) {
        console.error('Error creating checkout session:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

async function cancelSubscription(subscriptionId) {
    try {
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        });
        console.log(`Subscription with ID ${subscriptionId} will be canceled at ${updatedSubscription.cancel_at}.`);
        return {
            message: `Subscription with ID ${subscriptionId} will be canceled at ${updatedSubscription.cancel_at}.`,
            updatedSubscription,
            success: true
        };
    } catch (error) {
        console.error(`Failed to set cancellation for subscription: ${error.message}`);
        throw error;
    }
}

app.post('/get-subscription', async (req, res) => {
    try {
        const { email, priceId } = req.body;
        const data = await handleCustomerSubscription(email, priceId);
        res.send(data);
    } catch (error) {
        res.send(error.message);
    }
});


app.post('/create-subscription', async (req, res) => {
    try {
        const { customerId, priceId, couponId } = req.body;
        const data = await createCheckoutSession(customerId, priceId, couponId);
        res.send(data);
    } catch (error) {
        res.send(error.message);
    }
});

app.post('/cancel-subscription', async (req, res) => {
    try {
        const { subscriptionId } = req.body;
        const data = await cancelSubscription(subscriptionId);
        res.send(data);
    } catch (error) {
        res.send(error.message);
    }
});

app.get('/', async (req, res) => {
    res.json({
        message: `Server is running at ${PORT}`,
    });
});

import path from "path";

app.get("/success", (req, res) => {
    res.sendFile(path.join(__dirname, "success.html"));
})
app.get("/cancel", (req, res) => {
    res.sendFile(path.join(__dirname, "cancel.html"));
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
