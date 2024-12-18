import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const PORT = process.env.PORT || 4000;
const stripe = Stripe(process.env.STRIPE_SK);

const app = express();
app.use(cors());

// This is your Stripe CLI webhook secret for testing your endpoint locally.
const endpointSecret = process.env.WEBHOOK_SECRET;

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
        default: {
            // Return a 200 response to acknowledge receipt of the event
            response.status(200).send('Received');
        }
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
});

app.use(express.json());

async function handleCustomerSubscription(email) {
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
            status: 'active',
            limit: 1,
        });

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
            return { subscription: true, metadata: customer.metadata };
        } else {
            return { subscription: false, metadata: customer.metadata };
        }
    } catch (error) {
        console.error('Error handling customer subscription:', error);
        throw e, priceIdrror;
    }
}

async function createCheckoutSession(customerId, priceId) {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer: customerId,
            line_items: [
                {
                    price: process.env.MONTH,
                    quantity: 1,
                },
            ],
            success_url: process.env.SUCCESS_URL,
            cancel_url: process.env.CANCEL_URL,
        });

        return {
            success: true,
            url: session.url,
        };
    } catch (error) {
        console.error('Error creating checkout session:', error);
        return {
            success: false,
            message: error.message,
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
        };
    } catch (error) {
        console.error(`Failed to set cancellation for subscription: ${error.message}`);
        throw error;
    }
}

app.post('/get-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        const data = await handleCustomerSubscription(email);
        res.send(data);
    } catch (error) {
        res.send(error.message);
    }
});

app.post('/create-subscription', async (req, res) => {
    try {
        const { customerId, priceId } = req.body;
        const data = await createCheckoutSession(customerId, priceId);
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
        success: true
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
