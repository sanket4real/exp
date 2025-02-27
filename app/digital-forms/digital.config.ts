import df001Schema from "./[id]/temp-schema/d001.json";

const digitalFormsConfig: Record<string, DigitalForm> = {
	d001: {
		images: [
			"/pdf-form/d001/page-0.png",
			"/pdf-form/d001/page-1.png",
			"/pdf-form/d001/page-2.png",
		],
		schema: df001Schema,
		multipleCustomers: true,
	},
};

export default digitalFormsConfig;
