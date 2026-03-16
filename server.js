require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || "c417";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Ab80070225";

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const uploadDir = path.join(rootDir, "uploads");
const dbPath = path.join(rootDir, "database.db");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log("[REQUEST]", req.method, req.url);
  next();
});

app.use("/uploads", express.static(uploadDir));
app.use(express.static(publicDir));

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("資料庫連線失敗:", err.message);
  } else {
    console.log("SQLite 資料庫連線成功");
    db.run("PRAGMA foreign_keys = ON");
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function safeJsonParse(text, fallback = []) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isAdmin(account, password) {
  return account === ADMIN_ACCOUNT && password === ADMIN_PASSWORD;
}

function deleteFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("刪除檔案失敗:", filePath, error.message);
  }
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      sizes TEXT DEFAULT '[]',
      colors TEXT DEFAULT '[]',
      imageText TEXT DEFAULT '商品圖',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      status TEXT DEFAULT '待處理',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_image TEXT DEFAULT '',
      size TEXT DEFAULT '',
      color TEXT DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  const countRow = await get(`SELECT COUNT(*) as count FROM products`);
  if (!countRow || countRow.count === 0) {
    const sampleProducts = [
      {
        category: "樹剪",
        name: "高強度樹剪 A",
        code: "A-01",
        description: "適用園藝修枝與日常工作使用。\n刀片鋒利，握感穩定，適合長時間操作。",
        sizes: JSON.stringify(["S", "M", "L"]),
        colors: JSON.stringify(["紅", "黑"])
      },
      {
        category: "鎖",
        name: "安全掛鎖",
        code: "L-01",
        description: "耐用鎖芯設計，適用多種門櫃情境。",
        sizes: JSON.stringify(["30mm", "40mm", "50mm"]),
        colors: JSON.stringify(["銀", "黑"])
      },
      {
        category: "螺絲起子",
        name: "十字起子",
        code: "D-01",
        description: "符合人體工學握把，日常維修方便使用。",
        sizes: JSON.stringify(["小", "中", "大"]),
        colors: JSON.stringify(["黑黃"])
      }
    ];

    for (const item of sampleProducts) {
      await run(
        `
        INSERT INTO products (category, name, code, description, sizes, colors, imageText, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, '商品圖', CURRENT_TIMESTAMP)
        `,
        [item.category, item.name, item.code, item.description, item.sizes, item.colors]
      );
    }
  }
}

async function getProductImages(productId) {
  const rows = await all(
    `SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC`,
    [productId]
  );
  return rows.map((row) => row.image_url);
}

async function getProducts() {
  const products = await all(`SELECT * FROM products ORDER BY id DESC`);
  for (const product of products) {
    product.images = await getProductImages(product.id);
    product.sizes = safeJsonParse(product.sizes, ["標準"]);
    product.colors = safeJsonParse(product.colors, ["標準"]);
  }
  return products;
}

async function getProductById(id) {
  const product = await get(`SELECT * FROM products WHERE id = ?`, [id]);
  if (!product) return null;

  product.images = await getProductImages(product.id);
  product.sizes = safeJsonParse(product.sizes, ["標準"]);
  product.colors = safeJsonParse(product.colors, ["標準"]);
  return product;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  fileFilter(req, file, cb) {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname || "").toLowerCase();

    if (!allowed.includes(ext)) {
      return cb(new Error("只允許上傳 jpg、jpeg、png、webp 圖片"));
    }

    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.post("/api/admin/login", (req, res) => {
  const { account, password } = req.body;

  if (!isAdmin(account, password)) {
    return res.status(401).json({
      success: false,
      message: "帳號或密碼錯誤"
    });
  }

  res.json({
    success: true,
    message: "管理員登入成功"
  });
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await getProducts();
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "讀取商品失敗",
      error: error.message
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await getProductById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "找不到商品"
      });
    }

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "讀取商品失敗",
      error: error.message
    });
  }
});

app.get("/api/products/category/:category", async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM products WHERE category = ? ORDER BY id DESC`,
      [req.params.category]
    );

    for (const product of rows) {
      product.images = await getProductImages(product.id);
      product.sizes = safeJsonParse(product.sizes, ["標準"]);
      product.colors = safeJsonParse(product.colors, ["標準"]);
    }

    res.json({ success: true, products: rows });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "讀取分類商品失敗",
      error: error.message
    });
  }
});

app.post("/api/products", upload.array("images", 10), async (req, res) => {
  try {
    const {
      adminAccount,
      adminPassword,
      category,
      name,
      code,
      description = "",
      sizes = "[]",
      colors = "[]",
      imageText = "商品圖"
    } = req.body;

    if (!isAdmin(adminAccount, adminPassword)) {
      return res.status(401).json({
        success: false,
        message: "管理員驗證失敗"
      });
    }

    if (!category || !name || !code) {
      return res.status(400).json({
        success: false,
        message: "分類、名稱、編號必填"
      });
    }

    const exists = await get(`SELECT id FROM products WHERE code = ?`, [code]);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "商品編號已存在"
      });
    }

    const result = await run(
      `
      INSERT INTO products (category, name, code, description, sizes, colors, imageText, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [category, name, code, description, sizes, colors, imageText]
    );

    const productId = result.lastID;

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        await run(
          `INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)`,
          [productId, `/uploads/${req.files[i].filename}`, i]
        );
      }
    }

    const product = await getProductById(productId);

    res.json({
      success: true,
      message: "商品新增成功",
      product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "新增商品失敗",
      error: error.message
    });
  }
});

app.put("/api/products/:id", upload.array("images", 10), async (req, res) => {
  try {
    const productId = Number(req.params.id);

    const {
      adminAccount,
      adminPassword,
      category,
      name,
      code,
      description = "",
      sizes = "[]",
      colors = "[]",
      imageText = "商品圖",
      keepImages = "[]"
    } = req.body;

    if (!isAdmin(adminAccount, adminPassword)) {
      return res.status(401).json({
        success: false,
        message: "管理員驗證失敗"
      });
    }

    if (!category || !name || !code) {
      return res.status(400).json({
        success: false,
        message: "分類、名稱、編號必填"
      });
    }

    const oldProduct = await getProductById(productId);
    if (!oldProduct) {
      return res.status(404).json({
        success: false,
        message: "商品不存在"
      });
    }

    const exists = await get(
      `SELECT id FROM products WHERE code = ? AND id != ?`,
      [code, productId]
    );
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "商品編號已被使用"
      });
    }

    await run(
      `
      UPDATE products
      SET category = ?, name = ?, code = ?, description = ?, sizes = ?, colors = ?, imageText = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [category, name, code, description, sizes, colors, imageText, productId]
    );

    const keepImageList = safeJsonParse(keepImages, []);
    const oldImages = await all(
      `SELECT * FROM product_images WHERE product_id = ? ORDER BY id ASC`,
      [productId]
    );

    for (const row of oldImages) {
      if (!keepImageList.includes(row.image_url)) {
        await run(`DELETE FROM product_images WHERE id = ?`, [row.id]);

        const filePath = path.join(rootDir, row.image_url.replace(/^\//, ""));
        deleteFileIfExists(filePath);
      }
    }

    let sortOrder = keepImageList.length;
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await run(
          `INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)`,
          [productId, `/uploads/${file.filename}`, sortOrder++]
        );
      }
    }

    const product = await getProductById(productId);

    res.json({
      success: true,
      message: "商品修改成功",
      product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "修改商品失敗",
      error: error.message
    });
  }
});

app.post("/api/products/:id/delete", async (req, res) => {
  try {
    const { adminAccount, adminPassword } = req.body;

    if (!isAdmin(adminAccount, adminPassword)) {
      return res.status(401).json({
        success: false,
        message: "管理員驗證失敗"
      });
    }

    const productId = Number(req.params.id);
    const product = await getProductById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "商品不存在"
      });
    }

    for (const imageUrl of product.images) {
      const filePath = path.join(rootDir, imageUrl.replace(/^\//, ""));
      deleteFileIfExists(filePath);
    }

    await run(`DELETE FROM product_images WHERE product_id = ?`, [productId]);
    await run(`DELETE FROM products WHERE id = ?`, [productId]);

    res.json({
      success: true,
      message: "商品刪除成功"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "刪除商品失敗",
      error: error.message
    });
  }
});

app.post("/api/orders", async (req, res) => {
  console.log(">>> HIT /api/orders");
  try {
    const { username, items } = req.body;

    if (!username || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "訂單資料不完整"
      });
    }

    const result = await run(
      `INSERT INTO orders (username, status) VALUES (?, '待處理')`,
      [username]
    );
    const orderId = result.lastID;

    for (const item of items) {
      await run(
        `
        INSERT INTO order_items (order_id, product_id, product_name, product_code, product_image, size, color, qty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          orderId,
          item.id || null,
          item.name || "",
          item.code || "",
          item.image || "",
          item.size || "",
          item.color || "",
          Number(item.qty) || 1
        ]
      );
    }

    res.json({
      success: true,
      message: "訂單送出成功",
      orderId
    });
  } catch (error) {
    console.error("訂單送出失敗:", error);
    res.status(500).json({
      success: false,
      message: "訂單送出失敗",
      error: error.message
    });
  }
});

app.get("/api/orders/:username", async (req, res) => {
  try {
    const username = req.params.username;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "缺少使用者名稱"
      });
    }

    const orders = await all(
      `SELECT * FROM orders WHERE username = ? ORDER BY id DESC`,
      [username]
    );

    for (const order of orders) {
      order.items = await all(
        `SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`,
        [order.id]
      );
    }

    res.json({
      success: true,
      orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "讀取歷史訂單失敗",
      error: error.message
    });
  }
});

app.post("/api/admin/orders", async (req, res) => {
  try {
    const { adminAccount, adminPassword } = req.body;

    if (!isAdmin(adminAccount, adminPassword)) {
      return res.status(401).json({
        success: false,
        message: "管理員驗證失敗"
      });
    }

    const orders = await all(`SELECT * FROM orders ORDER BY id DESC`);

    for (const order of orders) {
      order.items = await all(
        `SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`,
        [order.id]
      );
    }

    res.json({
      success: true,
      orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "讀取全部訂單失敗",
      error: error.message
    });
  }
});

app.post("/api/admin/orders/:id/status", async (req, res) => {
  try {
    const { adminAccount, adminPassword, status } = req.body;
    const orderId = Number(req.params.id);

    if (!isAdmin(adminAccount, adminPassword)) {
      return res.status(401).json({
        success: false,
        message: "管理員驗證失敗"
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "狀態不可為空"
      });
    }

    const order = await get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "訂單不存在"
      });
    }

    await run(`UPDATE orders SET status = ? WHERE id = ?`, [status, orderId]);

    res.json({
      success: true,
      message: "訂單狀態更新成功"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "更新訂單狀態失敗",
      error: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "order.html"));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: `檔案上傳失敗：${err.message}`
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "伺服器發生錯誤"
    });
  }

  next();
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("資料庫初始化失敗:", error);
  });