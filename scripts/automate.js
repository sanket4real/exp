const fs = require("fs");
const path = require("path");
const os = require("os");

const SOURCE_DIR = "./uploads";
const PUBLIC_PDF_FORM = "../public/pdf-form";
const APP_DIGITAL_FORMS = "../app/digital-forms";
const DB_SCHEMA_DIR = "../app/digital-forms/dbSchema";
const CONFIG_FILE = "../app/digital-forms/digital.config.ts";
const tmpDir = path.join(os.tmpdir(), "digital_script");
const LOCK_FILE = path.join(tmpDir, "digital_script.lock");

// Ensure required directories exist
[PUBLIC_PDF_FORM, APP_DIGITAL_FORMS, DB_SCHEMA_DIR].forEach((dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
});

// Prevent multiple instances from running
if (!fs.existsSync(tmpDir)) {
	fs.mkdirSync(tmpDir, { recursive: true });
}
if (fs.existsSync(LOCK_FILE)) {
	console.log("⚠️ Script is already running. Exiting to prevent conflicts.");
	process.exit(1);
}
fs.writeFileSync(LOCK_FILE, "");
process.on("exit", () => fs.unlinkSync(LOCK_FILE));

// Function to get next available dXXX number
function getNextId() {
	const entries = fs
		.readdirSync(PUBLIC_PDF_FORM, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^d\d{3}$/.test(entry.name))
		.map((entry) => parseInt(entry.name.substring(1), 10));

	const nextNumber = entries.length ? Math.max(...entries) + 1 : 1;
	return `d${String(nextNumber).padStart(3, "0")}`;
}

// Check for folders in uploads/
const folders = fs
	.readdirSync(SOURCE_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

if (!folders.length) {
	console.log(`⚠️ No folders found in ${SOURCE_DIR}. Exiting script.`);
	process.exit(0);
}

// Backup existing config
fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);
let configContent = fs.readFileSync(CONFIG_FILE, "utf8");

const existingImports = configContent.match(/^import df\d{3}Schema.*$/gm) || [];
const configMatch = configContent.match(
	/const digitalFormsConfig: .*?= \{([\s\S]*?)\};/
);
let existingConfig = configMatch ? configMatch[1].trim() : "";
const firstTime = !configMatch;

if (!firstTime) {
	existingConfig = existingConfig.replace(/,$/, "");
}

let newImports = "";
let newConfig = "";

folders.forEach((folder) => {
	const formId = getNextId();
	const imageFolder = path.join(PUBLIC_PDF_FORM, formId);
	const jsonFolder = path.join(APP_DIGITAL_FORMS, "[id]", "temp-schema");
	const schemaFile = path.join(DB_SCHEMA_DIR, `${formId}.txt`);
	fs.mkdirSync(imageFolder, { recursive: true });
	fs.mkdirSync(jsonFolder, { recursive: true });

	console.log(`📂 Processing folder: ${folder} → FORM_ID: ${formId}`);

	let imageCount = 0;
	let imagePaths = [];

	fs.readdirSync(path.join(SOURCE_DIR, folder)).forEach((file) => {
		const filePath = path.join(SOURCE_DIR, folder, file);
		const ext = path.extname(file).toLowerCase();

		if ([".png", ".jpg", ".jpeg"].includes(ext)) {
			const newFilename = `page-${imageCount}${ext}`;
			fs.copyFileSync(filePath, path.join(imageFolder, newFilename));
			imagePaths.push(`"/pdf-form/${formId}/${newFilename}"`);
			imageCount++;
		} else if (ext === ".json") {
			const jsonFilename = `${formId}.json`;
			fs.copyFileSync(filePath, path.join(jsonFolder, jsonFilename));
		}
	});

	// Create new schema text file
	console.log(`📝 Creating schema file: ${schemaFile}`);
	const schemaContent = `[
    {
        "id": { "$oid": "" },
        "_class": "",
        "category": "",
        "description": "${folder}",
        "enabled": "",
        "formId": "${formId}",
        "img": { "$binary": { "base64": "", "subType": "" } },
        "journey": "",
        "name": "${folder}",
        "type": "",
        "wowJourney": {
            "exists": false,
            "reasonForNotTaking": [],
            "link": ""
        }
    }
]`;
	fs.writeFileSync(schemaFile, schemaContent);
	fs.chmodSync(schemaFile, 0o644);

	// Append new imports
	const schemaVar = `df${formId.substring(1)}Schema`;
	newImports += `import ${schemaVar} from "./[id]/temp-schema/${formId}.json";\n`;

	// Append new config entry
	newConfig += `\t${formId}: {\n`;
	newConfig += `\t\timages: [${imagePaths.join(",")}],\n`;
	newConfig += `\t\tschema: ${schemaVar},\n`;
	newConfig += `\t\tmultipleCustomers: true,\n`;
	newConfig += `\t},\n`;
});

// Construct final config file
const finalConfig = `${existingImports.join("\n")}\n${newImports}\n
const digitalFormsConfig: Record<string, DigitalForm> = {
${existingConfig}${firstTime ? "" : ","}${newConfig}
};

export default digitalFormsConfig;`;
fs.writeFileSync(CONFIG_FILE, finalConfig);

console.log("✅ Done!");
