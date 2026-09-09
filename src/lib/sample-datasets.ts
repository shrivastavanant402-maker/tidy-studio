import type { Row } from "./clean";

export type SampleDataset = {
  id: string;
  name: string;
  description: string;
  filename: string;
  rows: Row[];
};

export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    id: "ecommerce",
    name: "E-Commerce Global Orders",
    description: "Multi-currency retail data with messy dates, unformatted phones, and extreme outlier totals.",
    filename: "ecommerce_orders.csv",
    rows: [
      { order_id: "ORD-1001", customer_name: "John Doe", email: "john.doe@example.com", phone: "(555) 234-5678", order_date: "2026-01-15", total_amount: 129.99, state: "CA", status: "Delivered" },
      { order_id: "ORD-1002", customer_name: "SARAH CONNOR", email: "sarah[at]skynet.net", phone: "5558901234", order_date: "02/20/2026", total_amount: 450.00, state: "California", status: "shipped" },
      { order_id: "ORD-1003", customer_name: "Alex Rivera", email: "alex.rivera@domain", phone: "123", order_date: "INVALID_DATE", total_amount: 999999.00, state: "NY", status: "PENDING" },
      { order_id: "ORD-1004", customer_name: "Maya Lin", email: "maya@design.co", phone: "+1 555-456-7890", order_date: "2026-03-05", total_amount: 75.50, state: "new york", status: "Delivered" },
      { order_id: "ORD-1005", customer_name: "Liam Smith", email: "liam@smith.org", phone: "555-789-0123", order_date: "2026-03-12", total_amount: -25.00, state: "TX", status: "Cancelled" },
      { order_id: "ORD-1006", customer_name: "Emma Watson", email: "emma.watson@cinema.uk", phone: "555-321-6540", order_date: "2026-03-18", total_amount: 320.00, state: "Texas", status: "Shipped" },
      { order_id: "ORD-1007", customer_name: "David Kim", email: "dkim@techcorp.io", phone: "555-654-9870", order_date: "2026-03-22", total_amount: 210.00, state: "CA", status: "Delivered" },
      { order_id: "ORD-1008", customer_name: "John Doe", email: "john.doe@example.com", phone: "(555) 234-5678", order_date: "2026-01-15", total_amount: 129.99, state: "CA", status: "Delivered" }, // Duplicate row
      { order_id: "ORD-1009", customer_name: "Elena Rostova", email: "elena@space.org", phone: "555-901-2345", order_date: "2026-03-29", total_amount: 580.00, state: "Florida", status: "Processing" },
      { order_id: "ORD-1010", customer_name: "Carlos Mendez", email: "carlos@latam.biz", phone: "555-012-3456", order_date: "2026-04-02", total_amount: 95.00, state: "FL", status: "delivered" },
    ],
  },
  {
    id: "healthcare",
    name: "Clinical Patient Registry",
    description: "Patient telemetry containing missing vital signs, unstructured text, and invalid date formats.",
    filename: "patient_vitals_registry.xlsx",
    rows: [
      { patient_id: "PT-901", patient_name: "Robert Vance", dob: "1980-04-12", systolic_bp: 120, diastolic_bp: 80, pulse: 72, triage_code: "Green", recorded_at: "2026-02-10 09:30" },
      { patient_id: "PT-902", patient_name: "Alice Johnson", dob: "1992-11-05", systolic_bp: 135, diastolic_bp: 88, pulse: 84, triage_code: "green", recorded_at: "2026-02-10 10:15" },
      { patient_id: "PT-903", patient_name: "Marcus Aurelius", dob: "1975-08-30", systolic_bp: 240, diastolic_bp: 140, pulse: 999, triage_code: "Red", recorded_at: "NOT_A_TIMESTAMP" },
      { patient_id: "PT-904", patient_name: "BEATRICE POTTER", dob: "1988-06-21", systolic_bp: 118, diastolic_bp: 76, pulse: 68, triage_code: "GREEN", recorded_at: "2026-02-10 11:00" },
      { patient_id: "PT-905", patient_name: "Jin Woo", dob: "1999-01-14", systolic_bp: 128, diastolic_bp: null, pulse: 74, triage_code: "Yellow", recorded_at: "2026-02-10 11:45" },
      { patient_id: "PT-906", patient_name: "Sophia Martinez", dob: "1985-09-03", systolic_bp: 122, diastolic_bp: 82, pulse: 70, triage_code: "yellow", recorded_at: "2026-02-10 12:20" },
    ],
  },
  {
    id: "finance",
    name: "SaaS Subscription Billing",
    description: "B2B Recurring subscription accounts with currency symbols, duplicate company IDs, and missing plans.",
    filename: "subscription_billing.json",
    rows: [
      { account_id: "ACC-01", company: "Acme Corp", plan_tier: "Enterprise", mrr: "$4,500.00", billing_cycle: "Annual", seats: 150, renewal_date: "2026-12-31" },
      { account_id: "ACC-02", company: "Globex Inc", plan_tier: "Pro", mrr: "€1,200.00", billing_cycle: "monthly", seats: 35, renewal_date: "2026-06-15" },
      { account_id: "ACC-03", company: "Initech", plan_tier: "enterprise", mrr: "$12,000.00", billing_cycle: "Annual", seats: 400, renewal_date: "2026-09-30" },
      { account_id: "ACC-04", company: "Hooli", plan_tier: "Starter", mrr: "$299.00", billing_cycle: "MONTHLY", seats: 5, renewal_date: "2026-05-01" },
      { account_id: "ACC-05", company: "Umbrella Corp", plan_tier: "CUSTOM", mrr: "$500,000.00", billing_cycle: "annual", seats: 5000, renewal_date: "2027-01-01" },
      { account_id: "ACC-06", company: "Stark Industries", plan_tier: "Enterprise", mrr: "$25,000.00", billing_cycle: "Annual", seats: 850, renewal_date: "2026-11-15" },
    ],
  },
];
