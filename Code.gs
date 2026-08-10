/**
 * eBay自動メッセージ管理 - Google Apps Script バックエンド(フル版)
 * ------------------------------------------------------------
 * このスクリプトが唯一のバックエンドです。フロントエンド(index.html)は
 * GitHub Pages等の静的ホスティングに置き、全データ操作はここに集約します。
 *
 * スクリプトプロパティに以下を設定してください:
 *   EBAY_APP_ID / EBAY_DEV_ID / EBAY_CERT_ID / EBAY_AUTH_TOKEN
 *   SHARED_SECRET      : アプリ側と共有する合言葉
 *   ANTHROPIC_API_KEY  : console.anthropic.com で発行したAPIキー(翻訳用)
 *
 * デプロイ:
 *   「デプロイ」→「ウェブアプリ」→実行:自分/アクセス:全員 → URLを控える
 *   (index.html側の設定にこのURLとSHARED_SECRETを入力します)
 *
 * トリガー:
 *   createTrigger() を一度実行 → 15分おきに syncAll() が自動実行されます
 *
 * オファー(Best Offer)機能について:
 * 出品数が多い場合、全出品にGetBestOffersを呼ぶ方式はAPI呼び出し過多で
 * トークン無効化のリスクがあるため、eBayからの「オファー受信」通知メールを
 * Gmailで検知し、該当商品1件だけAPIを呼ぶ方式にしています。
 * (このアカウントのGmailにeBayの通知メールが届く設定になっている必要があります)
 * 初回実行時にGmailへのアクセス許可を求められるので許可してください。
 */

var SHEET_NAME = "EbayMessages";
var OFFER_SHEET_NAME = "EbayOffers";
var BUYER_SHEET_NAME = "EbayBuyerNotes";
var TEMPLATE_SHEET_NAME = "EbayTemplates";

// ========== 共通ユーティリティ ==========
function props_() {
  return PropertiesService.getScriptProperties();
}

function checkAuth_(token) {
  return token === props_().getProperty("SHARED_SECRET");
}

function ebayHeaders_(callName) {
  var p = props_();
  return {
    "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
    "X-EBAY-API-DEV-NAME": p.getProperty("EBAY_DEV_ID"),
    "X-EBAY-API-APP-NAME": p.getProperty("EBAY_APP_ID"),
    "X-EBAY-API-CERT-NAME": p.getProperty("EBAY_CERT_ID"),
    "X-EBAY-API-CALL-NAME": callName,
    "X-EBAY-API-SITEID": "0",
  };
}

function credsOk_() {
  var p = props_();
  return !!(p.getProperty("EBAY_APP_ID") && p.getProperty("EBAY_DEV_ID") && p.getProperty("EBAY_CERT_ID") && p.getProperty("EBAY_AUTH_TOKEN"));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ========== 翻訳(Claude API) ==========
function translate_(text, direction) {
  var apiKey = props_().getProperty("ANTHROPIC_API_KEY");
  var systemPrompt =
    direction === "en"
      ? "You are a translator. Translate the given Japanese reply into natural, polite English suitable for an eBay seller replying to a buyer. Output ONLY the English translation, nothing else."
      : "You are a translator. Translate the given English eBay buyer message into natural, polite Japanese. Output ONLY the Japanese translation, nothing else.";

  var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    payload: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    }),
    muteHttpExceptions: true,
  });

  var data = JSON.parse(res.getContentText());
  var block = (data.content || []).find(function (c) {
    return c.type === "text";
  });
  return block ? block.text.trim() : "";
}

// ========== シート取得 ==========
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("EbayMessengerData");
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["id", "buyerId", "buyerName", "text", "translatedJa", "createdAt", "category", "status", "replyDraft", "replyEn", "itemId"]);
  }
  return sheet;
}

function getOfferSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("EbayMessengerData");
  var sheet = ss.getSheetByName(OFFER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OFFER_SHEET_NAME);
    sheet.appendRow(["offerId", "itemId", "title", "buyerId", "price", "currency", "status", "fetchedAt"]);
  }
  return sheet;
}

function getBuyerSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("EbayMessengerData");
  var sheet = ss.getSheetByName(BUYER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BUYER_SHEET_NAME);
    sheet.appendRow(["buyerId", "notes"]);
  }
  return sheet;
}

function getTemplateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("EbayMessengerData");
  var sheet = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TEMPLATE_SHEET_NAME);
    sheet.appendRow(["id", "title", "en"]);
    sheet.appendRow(["t1", "発送遅延のお詫び", "Thank you for your patience. Your item has been slightly delayed but is on its way."]);
    sheet.appendRow(["t2", "購入お礼メッセージ", "Thank you very much for your purchase! I will ship it out promptly."]);
    sheet.appendRow(["t3", "商品説明との相違への対応", "I'm very sorry to hear that. Could you share a photo? I want to resolve this quickly."]);
  }
  return sheet;
}

function sheetToObjects_(sheet) {
  var rows = sheet.getDataRange().getValues();
  var header = rows.shift();
  return rows.map(function (r) {
    var o = {};
    header.forEach(function (h, i) {
      o[h] = r[i];
    });
    return o;
  });
}

function findRowById_(sheet, idColName, id) {
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf(idColName);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i + 1; // 1-indexed row
  }
  return -1;
}

// ========== eBayメッセージ取得 ==========
function fetchAndStoreMessages() {
  if (!credsOk_()) {
    Logger.log("eBay認証情報が未設定です。");
    return;
  }
  var p = props_();
  var authToken = p.getProperty("EBAY_AUTH_TOKEN");
  var lastSync = p.getProperty("LAST_SYNC") || Utilities.formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000), "UTC", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  var nowStr = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

  var xmlBody =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<RequesterCredentials><eBayAuthToken>" + authToken + "</eBayAuthToken></RequesterCredentials>" +
    "<MailMessageType>All</MailMessageType><DetailLevel>ReturnMessages</DetailLevel>" +
    "<StartCreationTime>" + lastSync + "</StartCreationTime><EndCreationTime>" + nowStr + "</EndCreationTime>" +
    "</GetMemberMessagesRequest>";

  var res = UrlFetchApp.fetch("https://api.ebay.com/ws/api.dll", {
    method: "post",
    contentType: "text/xml",
    headers: ebayHeaders_("GetMemberMessages"),
    payload: xmlBody,
    muteHttpExceptions: true,
  });

  var ns = XmlService.getNamespace("urn:ebay:apis:eBLBaseComponents");
  var root;
  try {
    root = XmlService.parse(res.getContentText()).getRootElement();
  } catch (e) {
    Logger.log("XML解析失敗: " + res.getContentText());
    return;
  }
  var ack = root.getChildText("Ack", ns);
  if (ack !== "Success" && ack !== "Warning") {
    Logger.log("eBay APIエラー: " + res.getContentText());
    return;
  }

  var sheet = getSheet_();
  var exchanges = root.getChildren("MemberMessageExchange", ns);

  exchanges.forEach(function (ex) {
    var m = ex.getChild("MemberMessage", ns);
    if (!m) return;
    var id = m.getChildText("ExternalMessageID", ns) || m.getChildText("MessageID", ns) || Utilities.getUuid();
    var sender = m.getChildText("Sender", ns) || "unknown";
    var text = m.getChildText("Text", ns) || "";
    var created = m.getChildText("CreationDate", ns) || nowStr;
    var createdMs = new Date(created).getTime();
    var itemId = m.getChildText("ItemID", ns) || "";

    var ja = "";
    try {
      ja = translate_(text, "ja");
    } catch (e) {
      ja = "";
    }

    sheet.appendRow([id, sender, sender, text, ja, createdMs, "通常", "未対応", "", "", itemId]);
  });

  p.setProperty("LAST_SYNC", nowStr);
  Logger.log(exchanges.length + "件の新着メッセージを処理しました。");
}

// ========== eBayオファー取得(Gmail通知トリガー方式) ==========
// 出品数が多い場合、全商品にGetBestOffersを呼ぶと呼び出し過多でトークンが
// 無効化されるリスクがあるため、eBayからの「オファー受信」メールをGmailで検知し、
// 該当商品1件だけAPIを呼ぶ方式に変更しています。

function checkOfferEmails() {
  if (!credsOk_()) return;
  var threads = GmailApp.search('from:ebay@ebay.com subject:"sent a new offer" is:unread newer_than:2d');
  var itemIds = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      if (!msg.isUnread()) return;
      var body = msg.getPlainBody();
      var match = body.match(/Item ID:\s*([0-9]+)/i);
      if (match) itemIds.push(match[1]);
      msg.markRead();
    });
  });

  var unique = itemIds.filter(function (id, i) {
    return itemIds.indexOf(id) === i;
  });

  unique.forEach(fetchOfferForItem_);
  Logger.log(unique.length + "件のオファー通知メールを処理しました。");
}

function fetchOfferForItem_(itemId) {
  var p = props_();
  var authToken = p.getProperty("EBAY_AUTH_TOKEN");
  var ns = XmlService.getNamespace("urn:ebay:apis:eBLBaseComponents");

  var body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<GetBestOffersRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<RequesterCredentials><eBayAuthToken>" + authToken + "</eBayAuthToken></RequesterCredentials>" +
    "<ItemID>" + itemId + "</ItemID><BestOfferStatus>Active</BestOfferStatus>" +
    "</GetBestOffersRequest>";

  var res = UrlFetchApp.fetch("https://api.ebay.com/ws/api.dll", {
    method: "post",
    contentType: "text/xml",
    headers: ebayHeaders_("GetBestOffers"),
    payload: body,
    muteHttpExceptions: true,
  });

  var root;
  try {
    root = XmlService.parse(res.getContentText()).getRootElement();
  } catch (e) {
    Logger.log("オファーXML解析失敗(ItemID " + itemId + "): " + res.getContentText());
    return;
  }
  var array = root.getChild("BestOfferArray", ns);
  if (!array) return;

  var sheet = getOfferSheet_();
  array.getChildren("BestOffer", ns).forEach(function (bo) {
    var boId = bo.getChildText("BestOfferID", ns);
    var status = bo.getChildText("Status", ns) || "";
    var buyerEl = bo.getChild("Buyer", ns);
    var buyerId = buyerEl ? buyerEl.getChildText("UserID", ns) : "";
    var priceEl = bo.getChild("Price", ns);
    var price = priceEl ? priceEl.getText() : "";
    var currency = priceEl ? priceEl.getAttributeValue("currencyID") : "";
    var itemEl = bo.getChild("Item", ns);
    var title = itemEl ? itemEl.getChildText("Title", ns) : "";
    var row = [boId, itemId, title || "", buyerId || "", price || "", currency || "", status, Date.now()];

    var existingRow = findRowById_(sheet, "offerId", boId);
    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

function respondToOffer_(itemId, offerId, decision) {
  var p = props_();
  var action = decision === "accept" ? "Accept" : "Decline";
  var body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<RespondToBestOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<RequesterCredentials><eBayAuthToken>" + p.getProperty("EBAY_AUTH_TOKEN") + "</eBayAuthToken></RequesterCredentials>" +
    "<ItemID>" + itemId + "</ItemID><BestOfferID>" + offerId + "</BestOfferID><Action>" + action + "</Action>" +
    "</RespondToBestOfferRequest>";

  var res = UrlFetchApp.fetch("https://api.ebay.com/ws/api.dll", {
    method: "post",
    contentType: "text/xml",
    headers: ebayHeaders_("RespondToBestOffer"),
    payload: body,
    muteHttpExceptions: true,
  });
  var ns = XmlService.getNamespace("urn:ebay:apis:eBLBaseComponents");
  var root = XmlService.parse(res.getContentText()).getRootElement();
  var ack = root.getChildText("Ack", ns);
  return ack === "Success" || ack === "Warning";
}

function escapeXml_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 実際にeBayへ返信を送信する(AddMemberMessageRTQ)
function sendReply_(itemId, buyerId, parentMessageId, text) {
  var p = props_();
  var ns = XmlService.getNamespace("urn:ebay:apis:eBLBaseComponents");
  var itemXml = itemId ? "<ItemID>" + itemId + "</ItemID>" : "";
  var parentXml = parentMessageId ? "<ParentMessageID>" + parentMessageId + "</ParentMessageID>" : "";

  var body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<RequesterCredentials><eBayAuthToken>" + p.getProperty("EBAY_AUTH_TOKEN") + "</eBayAuthToken></RequesterCredentials>" +
    itemXml +
    "<MemberMessage>" +
    "<QuestionType>General</QuestionType>" +
    "<RecipientID>" + buyerId + "</RecipientID>" +
    "<Body>" + escapeXml_(text) + "</Body>" +
    parentXml +
    "</MemberMessage>" +
    "</AddMemberMessageRTQRequest>";

  var res = UrlFetchApp.fetch("https://api.ebay.com/ws/api.dll", {
    method: "post",
    contentType: "text/xml",
    headers: ebayHeaders_("AddMemberMessageRTQ"),
    payload: body,
    muteHttpExceptions: true,
  });

  var root;
  try {
    root = XmlService.parse(res.getContentText()).getRootElement();
  } catch (e) {
    return { ok: false, error: "xml_parse_failed" };
  }
  var ack = root.getChildText("Ack", ns);
  if (ack === "Success" || ack === "Warning") return { ok: true };

  var errorsList = root.getChildren("Errors", ns);
  var errMsg = errorsList.length ? errorsList[0].getChildText("LongMessage", ns) : "unknown_error";
  return { ok: false, error: errMsg };
}

// ========== トリガー ==========
function syncAll() {
  fetchAndStoreMessages();
  checkOfferEmails();
}

function createTrigger() {
  ScriptApp.newTrigger("syncAll").timeBased().everyMinutes(15).create();
  Logger.log("15分おきのトリガーを作成しました。(メッセージ受信+オファーメール監視)");
}

// ========== Web App: GET(状態取得) ==========
function doGet(e) {
  if (e.parameter.action !== "state" || !checkAuth_(e.parameter.token)) {
    return json_({ error: "unauthorized_or_unknown" });
  }
  return json_({
    messages: sheetToObjects_(getSheet_()),
    offers: sheetToObjects_(getOfferSheet_()),
    buyerNotes: sheetToObjects_(getBuyerSheet_()),
    templates: sheetToObjects_(getTemplateSheet_()),
  });
}

// ========== Web App: POST(操作) ==========
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: "invalid_body" });
  }
  if (!checkAuth_(body.token)) return json_({ error: "unauthorized" });

  switch (body.action) {
    case "add_message": {
      var sheet = getSheet_();
      var id = Utilities.getUuid();
      var ja = "";
      try {
        ja = translate_(body.text, "ja");
      } catch (err) {
        ja = "";
      }
      var createdAt = Date.now();
      sheet.appendRow([id, body.buyerId || body.buyerName, body.buyerName, body.text, ja, createdAt, body.category || "通常", "未対応", "", "", ""]);
      return json_({ id: id, translatedJa: ja, createdAt: createdAt });
    }
    case "update_status": {
      var row = findRowById_(getSheet_(), "id", body.id);
      if (row < 0) return json_({ error: "not_found" });
      getSheet_().getRange(row, 8).setValue(body.status); // status is column 8
      return json_({ ok: true });
    }
    case "send_reply": {
      var msh = getSheet_();
      var mrow = findRowById_(msh, "id", body.id);
      if (mrow < 0) return json_({ error: "not_found" });
      var header = msh.getRange(1, 1, 1, msh.getLastColumn()).getValues()[0];
      var idx = {};
      header.forEach(function (h, i) {
        idx[h] = i;
      });
      var rowData = msh.getRange(mrow, 1, 1, msh.getLastColumn()).getValues()[0];
      var buyerId = rowData[idx.buyerId];
      var itemId = rowData[idx.itemId] || "";
      var parentId = rowData[idx.id];
      var textToSend = body.text || rowData[idx.replyEn];

      var result = sendReply_(itemId, buyerId, parentId, textToSend);
      if (result.ok) {
        msh.getRange(mrow, idx.status + 1).setValue("完了");
      }
      return json_(result);
    }
    case "save_reply": {
      var sh = getSheet_();
      var r = findRowById_(sh, "id", body.id);
      if (r < 0) return json_({ error: "not_found" });
      sh.getRange(r, 9).setValue(body.replyDraft || "");
      sh.getRange(r, 10).setValue(body.replyEn || "");
      return json_({ ok: true });
    }
    case "translate_reply": {
      var en = "";
      try {
        en = translate_(body.text, "en");
      } catch (err) {
        return json_({ error: "translate_failed" });
      }
      return json_({ en: en });
    }
    case "save_buyer_note": {
      var bs = getBuyerSheet_();
      var br = findRowById_(bs, "buyerId", body.buyerId);
      if (br < 0) {
        bs.appendRow([body.buyerId, body.notes || ""]);
      } else {
        bs.getRange(br, 2).setValue(body.notes || "");
      }
      return json_({ ok: true });
    }
    case "delete_template": {
      var tsh = getTemplateSheet_();
      var trow = findRowById_(tsh, "id", body.id);
      if (trow > 0) tsh.deleteRow(trow);
      return json_({ ok: true });
    }
    case "add_template": {
      var ts = getTemplateSheet_();
      var tid = Utilities.getUuid();
      ts.appendRow([tid, body.title || "", body.en || ""]);
      return json_({ id: tid });
    }
    case "respond_offer": {
      var ok = respondToOffer_(body.itemId, body.offerId, body.decision);
      if (ok) {
        var osh = getOfferSheet_();
        var orow = findRowById_(osh, "offerId", body.offerId);
        if (orow > 0) osh.deleteRow(orow);
      }
      return json_({ ok: ok });
    }
    default:
      return json_({ error: "unknown_action" });
  }
}
