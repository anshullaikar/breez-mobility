// Who is allowed to see or act on a given ride / event channel.
// Admins see everything; passengers and drivers only their own rides.

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

function isAdmin(user) {
  return ADMIN_ROLES.includes(user.role);
}

function canViewRide(user, ride) {
  return isAdmin(user) || ride.passengerId === user.id || ride.driverId === user.id;
}

module.exports = { ADMIN_ROLES, isAdmin, canViewRide };
