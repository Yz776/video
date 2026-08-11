// End-to-end cloud upload test: process a photo, then upload to cloud, verify URL works
const sharp = require("sharp");
const fs = require("fs");

async function main() {
  // 1. Read a real photo
  const srcBuf = fs.readFileSync("/home/z/my-project/scripts/real-clean-src.jpg");
  console.log(`1. Source photo: ${(srcBuf.length/1024).toFixed(1)} KB`);

  // 2. Process through our HEIC pipeline
  console.log("2. Processing through /api/process...");
  const fd = new FormData();
  const blob = new Blob([srcBuf], { type: "image/jpeg" });
  fd.append("file", blob, "photo.jpg");
  fd.append("upscale", "2");
  fd.append("quality", "98");
  fd.append("sharpen", "1");
  fd.append("denoise", "1");
  fd.append("enhance", "1");
  fd.append("filter", "none");
  fd.append("aspect", "free");
  fd.append("preview", "1");

  const t0 = Date.now();
  const processRes = await fetch("http://localhost:3000/api/process", {
    method: "POST",
    body: fd,
  });
  const processData = await processRes.json();
  console.log(`   Processed in ${Date.now()-t0}ms — ${processData.width}x${processData.height}`);

  // 3. Upload HEIC to cloud via our proxy
  console.log("3. Uploading HEIC to cloud via /api/cloud-upload...");
  const heicBytes = Buffer.from(processData.heic, "base64");
  console.log(`   HEIC size: ${(heicBytes.length/1024).toFixed(1)} KB`);
  const uploadFd = new FormData();
  const heicBlob = new Blob([heicBytes], { type: "image/heic" });
  uploadFd.append("file", heicBlob, `kangwifi-test-${Date.now()}.heic`);

  const t1 = Date.now();
  const uploadRes = await fetch("http://localhost:3000/api/cloud-upload", {
    method: "POST",
    body: uploadFd,
  });
  const uploadData = await uploadRes.json();
  console.log(`   Uploaded in ${Date.now()-t1}ms`);
  console.log("   Response:", JSON.stringify(uploadData, null, 2));

  if (!uploadData.success) {
    console.error("Upload failed!");
    process.exit(1);
  }

  // 4. Verify the URL works
  console.log("4. Verifying public URL works...");
  const fileRes = await fetch(uploadData.url, { method: "HEAD" });
  console.log(`   HEAD ${uploadData.url}: ${fileRes.status}`);
  console.log(`   Content-Type: ${fileRes.headers.get("content-type")}`);
  console.log(`   Content-Length: ${fileRes.headers.get("content-length")}`);

  // 5. List files
  console.log("5. Listing cloud files via /api/cloud-list...");
  const listRes = await fetch("http://localhost:3000/api/cloud-list?prefix=kangwifi-&images=1");
  const listData = await listRes.json();
  console.log(`   Found ${listData.files?.length ?? 0} kangwifi image files`);
  for (const f of (listData.files ?? []).slice(0, 5)) {
    console.log(`     - ${f.name} (${f.size_human}) — ${f.url}`);
  }

  // 6. Clean up - delete the test file
  if (uploadData.key) {
    console.log("6. Cleaning up test file...");
    const delRes = await fetch(`http://localhost:3000/api/cloud-delete?key=${encodeURIComponent(uploadData.key)}`, {
      method: "DELETE",
    });
    const delData = await delRes.json();
    console.log("   Delete:", delData);
  }

  console.log("\n=== END-TO-END TEST PASSED ===");
  console.log(`Photo: ${processData.width}x${processData.height} HEIC`);
  console.log(`Cloud URL: ${uploadData.url}`);
}

main().catch(e => { console.error(e); process.exit(1); });
