const paypal = require("../../helpers/paypal");
const Order = require("../../models/Order");
const Cart = require("../../models/Cart");
const Product = require("../../models/Product");

const createOrder = async (req, res) => {
  try {
    console.log("Received order request body:", JSON.stringify(req.body, null, 2));

    const {
      userId,
      cartItems,
      addressInfo,
      orderStatus,
      paymentMethod,
      paymentStatus,
      totalAmount,
      orderDate,
      orderUpdateDate,
      paymentId,
      payerId,
      cartId,
    } = req.body;

    // Validate required fields
    if (!userId || !cartItems || !addressInfo || !totalAmount) {
      console.log("Missing required fields:", {
        userId: !!userId,
        cartItems: !!cartItems,
        addressInfo: !!addressInfo,
        totalAmount: !!totalAmount
      });
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Validate cart items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      console.log("Invalid cart items:", cartItems);
      return res.status(400).json({
        success: false,
        message: "Invalid cart items"
      });
    }

    // Validate each cart item
    for (const item of cartItems) {
      if (!item.productId || !item.title || !item.price || !item.quantity || !item.size) {
        console.log("Invalid cart item:", item);
        return res.status(400).json({
          success: false,
          message: "Invalid cart item data"
        });
      }
    }

    // Validate total amount
    if (isNaN(Number(totalAmount)) || Number(totalAmount) <= 0) {
      console.log("Invalid total amount:", totalAmount);
      return res.status(400).json({
        success: false,
        message: "Invalid total amount"
      });
    }

    // Calculate item prices in USD with consistent rounding
    const itemsWithUSDPrice = cartItems.map((item) => {
      // Convert to cents to avoid floating point issues
      const priceInCents = Math.round(Number(item.price) / 200);
      const itemTotalInCents = priceInCents * Number(item.quantity);
      console.log(`Item ${item.title} - Price in cents: ${priceInCents}, Total in cents: ${itemTotalInCents}`);
      return {
        ...item,
        priceInCents,
        itemTotalInCents
      };
    });

    // Calculate total in cents
    const totalInCents = itemsWithUSDPrice.reduce((sum, item) => 
      sum + item.itemTotalInCents, 0);

    // Convert back to USD with 2 decimal places
    const finalAmount = (totalInCents / 100).toFixed(2);

    console.log("Payment amounts:", {
      totalInCents,
      finalAmount
    });

    // Ensure minimum payment amount for PayPal (0.01 USD)
    if (totalInCents < 1) {
      console.log("Payment amount too small:", finalAmount);
      return res.status(400).json({
        success: false,
        message: "Payment amount must be at least 0.01 USD"
      });
    }

    // Create items array with exact prices
    const items = itemsWithUSDPrice.map((item) => {
      const itemPrice = (item.priceInCents / 100).toFixed(2);
      console.log(`Item ${item.title} final price:`, {
        priceInCents: item.priceInCents,
        finalPrice: itemPrice,
        quantity: item.quantity,
        totalInCents: item.itemTotalInCents
      });
      
      return {
        name: `${item.title} (${item.size})`,
        sku: item.productId,
        price: itemPrice,
        currency: "USD",
        quantity: item.quantity
      };
    });

    // Create PayPal payment with simplified structure
    const create_payment_json = {
      intent: "sale",
      payer: {
        payment_method: "paypal"
      },
      redirect_urls: {
        return_url: "http://localhost:5173/shop/paypal-return",
        cancel_url: "http://localhost:5173/shop/paypal-cancel"
      },
      transactions: [
        {
          amount: {
            currency: "USD",
            total: finalAmount,
            details: {
              subtotal: finalAmount
            }
          },
          description: "Purchase from our store",
          item_list: {
            items: items
          }
        }
      ]
    };

    // Verify items total matches subtotal
    const itemsTotal = items.reduce((sum, item) => 
      sum + (Number(item.price) * Number(item.quantity)), 0).toFixed(2);
    
    console.log("Payment verification:", {
      itemsTotal,
      finalAmount,
      difference: Math.abs(Number(itemsTotal) - Number(finalAmount))
    });

    if (Math.abs(Number(itemsTotal) - Number(finalAmount)) > 0.001) {
      console.error("Items total does not match subtotal:", {
        itemsTotal,
        finalAmount,
        difference: Math.abs(Number(itemsTotal) - Number(finalAmount))
      });
      return res.status(400).json({
        success: false,
        message: "Items total does not match subtotal",
        details: {
          itemsTotal,
          finalAmount,
          difference: Math.abs(Number(itemsTotal) - Number(finalAmount))
        }
      });
    }

    // Log the payment request for debugging
    console.log("Creating PayPal payment with data:", JSON.stringify(create_payment_json, null, 2));

    paypal.payment.create(create_payment_json, async function (error, payment) {
      if (error) {
        console.error("PayPal payment creation error:", error);
        return res.status(500).json({
          success: false,
          message: "Error creating PayPal payment: " + error.message,
          error: error.response ? error.response : error,
          request: create_payment_json
        });
      }

      console.log("PayPal payment created successfully:", payment.id);

      const newOrder = new Order({
        userId,
        cartId,
        cartItems,
        addressInfo,
        orderStatus: orderStatus || "pending",
        paymentMethod,
        paymentStatus: paymentStatus || "pending",
        totalAmount,
        orderDate: orderDate || new Date(),
        orderUpdateDate: orderUpdateDate || new Date(),
        paymentId: payment.id,
        payerId
      });

      try {
        await newOrder.save();
        console.log("Order saved successfully:", newOrder._id);

        const approvalURL = payment.links.find(
          (link) => link.rel === "approval_url"
        ).href;

        res.status(201).json({
          success: true,
          data: newOrder,
          approvalURL,
          orderId: newOrder._id
        });
      } catch (saveError) {
        console.error("Error saving order:", saveError);
        res.status(500).json({
          success: false,
          message: "Error saving order: " + saveError.message
        });
      }
    });
  } catch (e) {
    console.error("Error in createOrder:", e);
    res.status(500).json({
      success: false,
      message: "Error creating order: " + e.message
    });
  }
};

const capturePayment = async (req, res) => {
  try {
    const { paymentId, payerId, orderId } = req.body;

    console.log("Capturing payment with data:", {
      paymentId,
      payerId,
      orderId
    });

    if (!paymentId || !payerId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment information"
      });
    }

    let order = await Order.findById(orderId);

    if (!order) {
      console.log("Order not found:", orderId);
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    console.log("Found order:", {
      orderId: order._id,
      totalAmount: order.totalAmount,
      status: order.orderStatus
    });

    // Calculate the total amount in USD
    const totalAmountUSD = (Number(order.totalAmount) / 20000).toFixed(2);

    // Execute the PayPal payment with minimal required fields
    const execute_payment_json = {
      payer_id: payerId
    };

    console.log("Executing PayPal payment with data:", JSON.stringify(execute_payment_json, null, 2));

    paypal.payment.execute(paymentId, execute_payment_json, async function (error, payment) {
      if (error) {
        console.error("PayPal payment execution error:", error);
        return res.status(500).json({
          success: false,
          message: "Error executing PayPal payment: " + error.message,
          error: error.response ? error.response : error
        });
      }

      if (!payment || !payment.state || payment.state !== 'approved') {
        console.error("Invalid payment state:", payment);
        return res.status(500).json({
          success: false,
          message: "Payment was not approved",
          payment: payment
        });
      }

      console.log("PayPal payment executed successfully:", payment.id);

      try {
        // Update order status
        order.paymentStatus = "paid";
        order.orderStatus = "pending"; // Keep order status as pending until admin confirms
        order.payerId = payerId;
        order.paymentDetails = {
          paymentId: payment.id,
          paymentState: payment.state,
          paymentDate: new Date(),
          paymentMethod: "paypal"
        };

        // Update stock for each product and size
        for (let item of order.cartItems) {
          console.log("Processing item:", {
            productId: item.productId,
            title: item.title,
            size: item.size,
            quantity: item.quantity
          });

          let product = await Product.findById(item.productId);

          if (!product) {
            console.log("Product not found:", item.productId);
            return res.status(404).json({
              success: false,
              message: `Product not found: ${item.title}`
            });
          }

          const sizeIndex = product.sizes.findIndex(s => s.size === item.size);
          if (sizeIndex === -1) {
            console.log("Size not found:", {
              product: item.title,
              size: item.size
            });
            return res.status(400).json({
              success: false,
              message: `Size ${item.size} not found for product ${item.title}`
            });
          }

          if (product.sizes[sizeIndex].stock < item.quantity) {
            console.log("Insufficient stock:", {
              product: item.title,
              size: item.size,
              requested: item.quantity,
              available: product.sizes[sizeIndex].stock
            });
            return res.status(400).json({
              success: false,
              message: `Not enough stock for size ${item.size} of product ${item.title}`
            });
          }

          product.sizes[sizeIndex].stock -= item.quantity;
          product.totalStock = product.sizes.reduce((total, size) => total + size.stock, 0);

          await product.save();
          console.log("Updated product stock:", {
            product: item.title,
            size: item.size,
            newStock: product.sizes[sizeIndex].stock
          });
        }

        // Delete the cart
        if (order.cartId) {
          await Cart.findByIdAndDelete(order.cartId);
          console.log("Deleted cart:", order.cartId);
        }

        await order.save();
        console.log("Order updated successfully:", {
          orderId: order._id,
          status: order.orderStatus,
          paymentStatus: order.paymentStatus
        });

        res.status(200).json({
          success: true,
          message: "Order processed successfully",
          data: {
            orderId: order._id,
            status: order.orderStatus,
            paymentStatus: order.paymentStatus,
            paymentDetails: order.paymentDetails
          }
        });
      } catch (saveError) {
        console.error("Error saving order or updating products:", saveError);
        res.status(500).json({
          success: false,
          message: "Error updating order: " + saveError.message,
          error: saveError
        });
      }
    });
  } catch (e) {
    console.error("Error in capturePayment:", e);
    res.status(500).json({
      success: false,
      message: "Error capturing payment: " + e.message,
      error: e
    });
  }
};

const getAllOrdersByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const orders = await Order.find({ userId });

    if (!orders.length) {
      return res.status(404).json({
        success: false,
        message: "No orders found!",
      });
    }

    res.status(200).json({
      success: true,
      data: orders,
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({
      success: false,
      message: "Some error occured!",
    });
  }
};

const getOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found!",
      });
    }

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({
      success: false,
      message: "Some error occured!",
    });
  }
};

module.exports = {
  createOrder,
  capturePayment,
  getAllOrdersByUser,
  getOrderDetails,
};
