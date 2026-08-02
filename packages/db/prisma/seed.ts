import { PrismaClient, ServiceType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_REQUIREMENTS: Record<ServiceType, string[]> = {
  KARTU_KELUARGA: [
    "Foto/scan KTP kepala keluarga",
    "Foto/scan Buku Nikah atau Akta Perkawinan",
    "Foto/scan Surat Pengantar RT/RW",
    "Foto/scan Kartu Keluarga lama (jika perubahan data)",
  ],
  AKTE_KEMATIAN: [
    "Foto/scan Surat Keterangan Kematian dari Rumah Sakit/Puskesmas/Dokter",
    "Foto/scan KTP almarhum/almarhumah",
    "Foto/scan Kartu Keluarga almarhum/almarhumah",
    "Foto/scan KTP pelapor",
    "Foto/scan Surat Pengantar RT/RW",
  ],
  AKTE_KELAHIRAN: [
    "Foto/scan Surat Keterangan Lahir dari Rumah Sakit/Bidan",
    "Foto/scan Buku Nikah orang tua",
    "Foto/scan KTP kedua orang tua",
    "Foto/scan Kartu Keluarga orang tua",
    "Foto/scan Surat Pengantar RT/RW",
  ],
};

async function main() {
  const existingAdmin = await prisma.admin.findUnique({ where: { username: "admin" } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("admin123", 10);
    await prisma.admin.create({
      data: { username: "admin", passwordHash, name: "Administrator" },
    });
    console.log('Admin default dibuat -> username: "admin", password: "admin123" (SEGERA GANTI setelah login pertama)');
  } else {
    console.log("Admin default sudah ada, dilewati.");
  }

  await prisma.botSession.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, connected: false },
  });

  for (const [serviceType, names] of Object.entries(DEFAULT_REQUIREMENTS) as [ServiceType, string[]][]) {
    for (let i = 0; i < names.length; i++) {
      const isKtp = names[i].toUpperCase().includes("KTP");
      const existing = await prisma.requirementTemplate.findFirst({
        where: { serviceType, name: names[i] },
      });
      if (!existing) {
        await prisma.requirementTemplate.create({
          data: { serviceType, name: names[i], order: i + 1, active: true, ocrKtp: isKtp },
        });
      } else if (isKtp && !existing.ocrKtp) {
        // syarat KTP yang sudah ada dari sebelum fitur OCR ditambahkan - tandai juga.
        await prisma.requirementTemplate.update({ where: { id: existing.id }, data: { ocrKtp: true } });
      }
    }
  }
  console.log("Syarat default per layanan sudah diseed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
