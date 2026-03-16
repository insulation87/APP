const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = 3000;

const ADMIN_ACCOUNT = "c417";
const ADMIN_PASSWORD = "Ab80070225";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

const db = new sqlite3.Database(path.join(__dirname, "database.db"));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      desc TEXT DEFAULT '',
      sizes TEXT DEFAULT '[]',
      colors TEXT DEFAULT '[]',
      imageText TEXT DEFAULT '商品圖',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getAllProductsWithImages() {
  const products = await allQuery(`
    SELECT *
    FROM products
    ORDER BY id DESC
  `);

  for (const product of products) {
    const images = await allQuery(
      `SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC`,
      [product.id]
    );

    product.images = images.map(img => img.image_url);
    product.sizes = safeJsonParse(product.sizes, ["標準"]);
    product.colors = safeJsonParse(product.colors, ["標準"]);
  }

  return products;
}

async function getOneProductWithImages(id) {
  const product = await getQuery(`SELECT * FROM products WHERE id = ?`, [id]);
  if (!product) return null;

  const images = await allQuery(
    `SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC`,
    [id]
  );

  product.images = images.map(img => img.image_url);
  product.sizes = safeJsonParse(product.sizes, ["標準"]);
  product.colors = safeJsonParse(product.colors, ["標準"]);

  return product;
}

function safeJsonParse(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isAdminLogin(account, password) {
  return account === ADMIN_ACCOUNT && password === ADMIN_PASSWORD;
}

app.post("/api/admin/login", (req, res) => {
  const { account, password } = req.body;

  if (isAdminLogin(account, password)) {
    return res.json({
      success: true,
      message: "管理員登入成功"
    });
  }

  return res.status(401).json({
    success: false,
    message: "帳號或密碼錯誤"
  });
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await getAllProductsWithImages();
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: "讀取商品失敗", error: error.message });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await getOneProductWithImages(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "找不到商品" });
    }

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: "讀取商品失敗", error: error.message });
  }
});

app.post("/api/products", upload.array("images", 10), async (req, res) => {
  try {
    const {
      category,
      name,
      code,
      desc = "",
      sizes = "[]",
      colors = "[]",
      imageText = "商品圖",
      adminAccount,
      adminPassword
    } = req.body;

    if (!isAdminLogin(adminAccount, adminPassword)) {
      return res.status(401).json({ success: false, message: "管理員驗證失敗" });
    }

    if (!category || !name || !code) {
      return res.status(400).json({ success: false, message: "分類、名稱、編號必填" });
    }

    const exists = await getQuery(`SELECT * FROM products WHERE code = ?`, [code]);
    if (exists) {
      return res.status(400).json({ success: false, message: "商品編號已存在" });
    }

    const result = await runQuery(
      `
      INSERT INTO products (category, name, code, desc, sizes, colors, imageText, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [category, name, code, desc, sizes, colors, imageText]
    );

    const productId = result.lastID;

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const imageUrl = `/uploads/${file.filename}`;
        await runQuery(
          `INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)`,
          [productId, imageUrl, i]
        );
      }
    }

    const product = await getOneProductWithImages(productId);
    res.json({ success: true, message: "商品新增成功", product });
  } catch (error) {
    res.status(500).json({ success: false, message: "新增商品失敗", error: error.message });
  }
});

app.put("/api/products/:id", upload.array("images", 10), async (req, res) => {
  try {
    const productId = req.params.id;
    const {
      category,
      name,
      code,
      desc = "",
      sizes = "[]",
      colors = "[]",
      imageText = "商品圖",
      keepImages = "[]",
      adminAccount,
      adminPassword
    } = req.body;

    if (!isAdminLogin(adminAccount, adminPassword)) {
      return res.status(401).json({ success: false, message: "管理員驗證失敗" });
    }

    const oldProduct = await getOneProductWithImages(productId);
    if (!oldProduct) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    const codeExists = await getQuery(
      `SELECT * FROM products WHERE code = ? AND id != ?`,
      [code, productId]
    );

    if (codeExists) {
      return res.status(400).json({ success: false, message: "商品編號已被其他商品使用" });
    }

    await runQuery(
      `
      UPDATE products
      SET category = ?, name = ?, code = ?, desc = ?, sizes = ?, colors = ?, imageText = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [category, name, code, desc, sizes, colors, imageText, productId]
    );

    const keepImageList = safeJsonParse(keepImages, []);
    const oldImages = await allQuery(
      `SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC`,
      [productId]
    );

    for (const oldImg of oldImages) {
      if (!keepImageList.includes(oldImg.image_url)) {
        await runQuery(`DELETE FROM product_images WHERE id = ?`, [oldImg.id]);

        const filePath = path.join(__dirname, oldImg.image_url.replace(/^\//, ""));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    let startOrder = keepImageList.length;

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const imageUrl = `/uploads/${file.filename}`;
        await runQuery(
          `INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)`,
          [productId, imageUrl, startOrder + i]
        );
      }
    }

    const product = await getOneProductWithImages(productId);
    res.json({ success: true, message: "商品修改成功", product });
  } catch (error) {
    res.status(500).json({ success: false, message: "修改商品失敗", error: error.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const { adminAccount, adminPassword } = req.body;

    if (!isAdminLogin(adminAccount, adminPassword)) {
      return res.status(401).json({ success: false, message: "管理員驗證失敗" });
    }

    const productId = req.params.id;
    const product = await getOneProductWithImages(productId);

    if (!product) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    for (const imgUrl of product.images) {
      const filePath = path.join(__dirname, imgUrl.replace(/^\//, ""));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await runQuery(`DELETE FROM product_images WHERE product_id = ?`, [productId]);
    await runQuery(`DELETE FROM products WHERE id = ?`, [productId]);

    res.json({ success: true, message: "商品刪除成功" });
  } catch (error) {
    res.status(500).json({ success: false, message: "刪除商品失敗", error: error.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "order.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});