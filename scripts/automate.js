const fs = require("fs");
const path = require("path");

// Define base directories
const SOURCE_DIR = "./uploads";
const PUBLIC_PDF_FORM = "../public/pdf-form";
const APP_DIGITAL_FORMS = "../app/digital-forms";
const DB_SCHEMA_DIR = "../app/digital-forms/dbSchema";
const CONFIG_FILE = "../app/digital-forms/digital.config.ts";

// Create required directories
[PUBLIC_PDF_FORM, APP_DIGITAL_FORMS, DB_SCHEMA_DIR].forEach((dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
});

// Function to get next available dXXX number
function getNextId(basePath) {
	try {
		const files = fs.readdirSync(basePath);
		const numbers = files
			.filter((f) => /^d\d{3}(\.json)?$/.test(f))
			.map((f) => parseInt(f.replace(/[^0-9]/g, ""), 10));

		const lastNumber = Math.max(0, ...numbers);
		return `d${String(lastNumber + 1).padStart(3, "0")}`;
	} catch {
		return "d001";
	}
}

// Backup existing config
fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);

// Read existing config file
let existingConfig = "";
let existingImports = "";
let firstTime = true;

try {
	const configContent = fs.readFileSync(CONFIG_FILE, "utf8");
	existingImports = (
		configContent.match(/^import df\d{3}Schema.*$/gm) || []
	).join("\n");

	const configMatch = configContent.match(
		/const digitalFormsConfig = {[\s\S]*?};/
	);
	if (configMatch) {
		existingConfig = configMatch[0].replace(/};$/, "");
		firstTime = false;
	} else {
		existingConfig = "const digitalFormsConfig = {";
	}
} catch {
	existingConfig = "const digitalFormsConfig = {";
}

let newImports = "";
let newConfig = "";

// Process each subdirectory in uploads/
const uploadDirs = fs.readdirSync(SOURCE_DIR);

uploadDirs.forEach((folderName) => {
	const dirPath = path.join(SOURCE_DIR, folderName);
	if (!fs.statSync(dirPath).isDirectory()) return;

	const FORM_ID = getNextId(PUBLIC_PDF_FORM);
	const IMAGE_FOLDER = path.join(PUBLIC_PDF_FORM, FORM_ID);
	const JSON_FOLDER = path.join(APP_DIGITAL_FORMS, "[id]", "temp-schema");
	const SCHEMA_FILE = path.join(DB_SCHEMA_DIR, `${FORM_ID}.txt`);

	fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
	fs.mkdirSync(JSON_FOLDER, { recursive: true });

	console.log(`📂 Processing folder: ${dirPath} → FORM_ID: ${FORM_ID}`);

	let imageCount = 0;
	const imagePaths = [];

	fs.readdirSync(dirPath).forEach((file) => {
		const filePath = path.join(dirPath, file);
		if (!fs.statSync(filePath).isFile()) return;

		const ext = path.extname(file).toLowerCase();

		if ([".png", ".jpg", ".jpeg"].includes(ext)) {
			const newFilename = `page-${imageCount}${ext}`;
			fs.copyFileSync(filePath, path.join(IMAGE_FOLDER, newFilename));
			imagePaths.push(`"/pdf-form/${FORM_ID}/${newFilename}"`);
			imageCount++;
		} else if (ext === ".json") {
			const jsonFilename = `${FORM_ID}.json`;
			fs.copyFileSync(filePath, path.join(JSON_FOLDER, jsonFilename));
		}
	});

	// Create schema file
	const schemaContent = JSON.stringify(
		[
			{
				id: { $oid: "" },
				_class: "",
				category: "",
				description: folderName,
				enabled: "",
				formid: FORM_ID,
				img: {
					$binary: {
						base64: "",
						subType: "",
					},
				},
				journey: "",
				name: folderName,
				type: "",
				wowJourney: {
					exists: false,
					reasonForNotTaking: [],
					link: "",
				},
			},
		],
		null,
		2
	);

	fs.writeFileSync(SCHEMA_FILE, schemaContent);

	const schemaVar = `df${FORM_ID.substring(1)}Schema`;
	newImports += `import ${schemaVar} from "./[id]/temp-schema/${FORM_ID}.json";\n`;

	newConfig += `\t${FORM_ID}: {\n`;
	newConfig += `\t\timages: [${imagePaths.join(",")}],\n`;
	newConfig += `\t\tschema: ${schemaVar},\n`;
	newConfig += `\t\tmultipleCustomers: false,\n`;
	newConfig += `\t},\n`;
});

// Construct final config file
const finalConfig = [
	[...new Set(existingImports.split("\n").concat(newImports.split("\n")))]
		.filter(Boolean)
		.join("\n"),
	"",
	existingConfig,
	firstTime ? newConfig.replace(/^,/, "") : newConfig,
	"};",
	"",
	"export default digitalFormsConfig;",
].join("\n");

fs.writeFileSync(CONFIG_FILE, finalConfig);
console.log("✅ All files copied and digital.config.ts updated successfully!");
