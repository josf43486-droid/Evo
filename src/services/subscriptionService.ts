import { db, collection, getDocs, updateDoc, doc, deleteDoc, query, where, Timestamp } from '../backend';
import { ServerInstance } from '../types';

export async function checkExpiredServers() {
  const now = Timestamp.now();
  const serversRef = collection(db, 'servers');
  
  // Get all active or suspended servers
  const querySnapshot = await getDocs(serversRef);
  
  for (const serverDoc of querySnapshot.docs) {
    const server = { id: serverDoc.id, ...serverDoc.data() } as ServerInstance;
    
    if (!server.expiresAt) continue;

    const expiresAt = server.expiresAt instanceof Timestamp 
      ? server.expiresAt.toDate() 
      : new Date(server.expiresAt);
    
    const diffTime = now.toDate().getTime() - expiresAt.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    // If expired and not suspended
    if (diffDays > 0 && server.status !== 'suspended') {
      await updateDoc(doc(db, 'servers', server.id), {
        status: 'suspended',
        isSuspended: true
      });
      console.log(`Server ${server.id} suspended due to expiration.`);
    }

    // لا نحذف ملفات المستخدم تلقائياً بعد انتهاء الاشتراك؛ يظل المشروع محفوظاً حتى التجديد أو الحذف اليدوي.
  }
}
