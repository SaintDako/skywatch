var express = require('express');
var _ = require('lodash');
var async = require('async');
var crypto = require('crypto');
var nodemailer = require('nodemailer');
var passport = require('passport');
var User = require('../models/User');
var secrets = require('../config/secrets');

eventLabels = {meteors: 'Meteor Showers', solar_eclipses: 'Solar Eclipses', lunar_eclipses: 'Lunar Eclipses'};
timeLabels  = {'1h': '1 hour', '3h': '3 hours', '6h': '6 hours', '12h': '12 hours', '24h': '24 hours'};

module.exports = function(app, nev) {

// GET login page
app.get('/login', function(req, res) {
  if (req.user) 
    return res.redirect('/');
  res.render('account/login', {title: 'Login'});
});

// POST login (login attempt)
app.post('/login', function(req, res, next) {
  req.assert('email', 'Email is not valid').isEmail();
  req.assert('password', 'Password cannot be blank').notEmpty();

  var errors = req.validationErrors();

  if (errors) {
    req.flash('errors', errors);
    return res.redirect('/login');
  }

  passport.authenticate('local', function(err, user, info) {
    if (err) return next(err);
    if (!user) {
      req.flash('errors', { msg: info.message });
      return res.redirect('/login');
    }
    req.logIn(user, function(err) {
      if (err) return next(err);
      res.redirect(req.session.returnTo || '/account');
    });
  })(req, res, next);
});

// GET logout (attempt logging out)
app.get('/logout', function(req, res) {
  req.logout();
  res.redirect('/');
});

// GET signup page
app.get('/signup', function(req, res) {
  if (req.user) 
    return res.redirect('/');
  res.render('account/signup', {title: 'Create Account'});
});

// POST signup (signup attempt)
app.post('/signup', function(req, res, next) {
  // uses express-validator middleware
  req.assert('email', 'Email is not valid').isEmail();
  req.assert('password', 'Password must be at least 4 characters long').len(4);
  req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password);

  var errors = req.validationErrors();

  // if email or password isn't legit...
  if (errors) {
    req.flash('errors', errors);
    return res.redirect('/signup');
  }

  var user = new User({
    email: req.body.email,
    password: req.body.password
  });

  nev.createTempUser(user, function(err, newTempUser) {
    // new user created
    if (newTempUser) {
      newTempUser.password = newTempUser.generateHash(newTempUser.password);
      nev.registerTempUser(newTempUser, function(err) {
        req.flash('success', {msg: 'An email has been sent to you. Please check it to verify your account.'});
        res.redirect('/login');
      });

    // user already exists in temporary collection!
    } else {
      req.flash('errors', {msg: 'You have already signed up. Please check your email to verify your account.'});
      res.redirect('/signup');
    }
  });
});

// GET account page
app.get('/account', function(req, res) {
  console.log(req.user.id);
  User.findById(req.user.id, function(err, user) {
    var events = {},
      notifs   = {};
    user.events.forEach(function(ev) {
      events[ev.event] = true;
    });
    user.notifications.forEach(function(t) {
      notifs[t] = true;
    });

    res.render('account/profile', {
      events: events,
      eventLabels: eventLabels,
      timeLabels: timeLabels,
      notifs: notifs,
      methods: user.methods
    });
  });
});

/**
 * POST /account/profile
 * Update profile information.
 */
app.post('/account/profile', function(req, res, next) {
  User.findById(req.user.id, function(err, user) {
    if (err) 
      return next(err);
    user.email = req.body.email || '';
    user.phone = req.body.phone || '';

    user.save(function(err) {
      if (err) 
        return next(err);
      req.flash('success', { msg: 'Profile information updated.' });
      res.redirect('/account');
    });
  });
});

app.post('/account/notifications/events', function(req, res, next) {
  User.findById(req.user.id, function(err, user) {
    if (err) return next(err);
    var events = [];
    
    for (var ev in req.body) {
      if (ev != '_csrf')
        events.push({'event': ev});
    }

    user.events = events;
    user.save(function(err) {
      if (err) return next(err);
      req.flash('success', {msg: 'Event settings updated.'});
      res.redirect('/account');
    });
  });
});

app.post('/account/notifications/timing', function(req,res,next) {
  User.findById(req.user.id, function(err,user) {
    if (err) 
      return next(err);
    var times = [];

    for (var time in req.body) {
      if (time != '_csrf')
        times.push(time);
    }

    user.notifications = times;
    user.save(function(err) {
      if (err) 
        return next(err);
      req.flash('success', {msg: 'Timing settings updated.'});
      res.redirect('/account');
    });
  });
});

/**
 * POST /account/password
 * Update current password.
 */
app.post('/account/password', function(req, res, next) {
  // User.findById(req.user.id, function(err,user) {
  //   if (err) return next(err);
  //   req.assert('oldPassword', 'Incorrect (old) password.').equals(user.password);
  // });
  req.assert('password', 'Password must be at least 4 characters long').len(4);
  req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password);

  var errors = req.validationErrors();

  if (errors) {
    req.flash('errors', errors);
    return res.redirect('/account');
  }

  User.findById(req.user.id, function(err, user) {
    if (err) return next(err);

    user.password = req.body.password;

    user.save(function(err) {
      if (err) return next(err);
      req.flash('success', { msg: 'Password has been changed.' });
      res.redirect('/account');
    });
  });
});

/**
 * POST /account/delete
 * Delete user account.
 */
app.post('/account/delete', function(req, res, next) {
  User.remove({ _id: req.user.id }, function(err) {
    if (err) return next(err);
    req.logout();
    req.flash('info', { msg: 'Your account has been deleted.' });
    res.redirect('/');
  });
});

/**
 * GET /account/unlink/:provider
 * Unlink OAuth provider.
 */
app.get('/account/unlink/:provider', function(req, res, next) {
  var provider = req.params.provider;
  User.findById(req.user.id, function(err, user) {
    if (err) return next(err);

    user[provider] = undefined;
    user.tokens = _.reject(user.tokens, function(token) { return token.kind === provider; });

    user.save(function(err) {
      if (err) return next(err);
      req.flash('info', { msg: provider + ' account has been unlinked.' });
      res.redirect('/account');
    });
  });
});

/**
 * GET /reset/:token
 * Reset Password page.
 */
app.get('/reset/:token', function(req, res) {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  User
    .findOne({ resetPasswordToken: req.params.token })
    .where('resetPasswordExpires').gt(Date.now())
    .exec(function(err, user) {
      if (!user) {
        req.flash('errors', { msg: 'Password reset token is invalid or has expired.' });
        return res.redirect('/forgot');
      }
      res.render('account/reset', {
        title: 'Password Reset'
      });
    });
});

/**
 * POST /reset/:token
 * Process the reset password request.
 */
app.post('/reset/:token', function(req, res, next) {
  req.assert('password', 'Password must be at least 4 characters long.').len(4);
  req.assert('confirm', 'Passwords must match.').equals(req.body.password);

  var errors = req.validationErrors();

  if (errors) {
    req.flash('errors', errors);
    return res.redirect('back');
  }

  async.waterfall([
    function(done) {
      User
        .findOne({ resetPasswordToken: req.params.token })
        .where('resetPasswordExpires').gt(Date.now())
        .exec(function(err, user) {
          if (!user) {
            req.flash('errors', { msg: 'Password reset token is invalid or has expired.' });
            return res.redirect('back');
          }

          user.password = req.body.password;
          user.resetPasswordToken = undefined;
          user.resetPasswordExpires = undefined;

          user.save(function(err) {
            if (err) return next(err);
            req.logIn(user, function(err) {
              done(err, user);
            });
          });
        });
    },
    function(user, done) {
      var transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: secrets.sendgrid.user,
          pass: secrets.sendgrid.password
        }
      });
      var mailOptions = {
        to: user.email,
        from: 'hackathon@starter.com',
        subject: 'Your Hackathon Starter password has been changed',
        text: 'Hello,\n\n' +
          'This is a confirmation that the password for your account ' + user.email + ' has just been changed.\n'
      };
      transporter.sendMail(mailOptions, function(err) {
        req.flash('success', { msg: 'Success! Your password has been changed.' });
        done(err);
      });
    }
  ], function(err) {
    if (err) return next(err);
    res.redirect('/');
  });
});

/**
 * GET /forgot
 * Forgot Password page.
 */
app.get('/forgot', function(req, res) {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('account/forgot', {
    title: 'Forgot Password'
  });
});

/**
 * POST /forgot
 * Create a random token, then the send user an email with a reset link.
 */
app.post('/forgot', function(req, res, next) {
  req.assert('email', 'Please enter a valid email address.').isEmail();

  var errors = req.validationErrors();

  if (errors) {
    req.flash('errors', errors);
    return res.redirect('/forgot');
  }

  async.waterfall([
    function(done) {
      crypto.randomBytes(16, function(err, buf) {
        var token = buf.toString('hex');
        done(err, token);
      });
    },
    function(token, done) {
      User.findOne({ email: req.body.email.toLowerCase() }, function(err, user) {
        if (!user) {
          req.flash('errors', { msg: 'No account with that email address exists.' });
          return res.redirect('/forgot');
        }

        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

        user.save(function(err) {
          done(err, token, user);
        });
      });
    },
    function(token, user, done) {
      var transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: secrets.sendgrid.user,
          pass: secrets.sendgrid.password
        }
      });
      var mailOptions = {
        to: user.email,
        from: 'hackathon@starter.com',
        subject: 'Reset your password on Hackathon Starter',
        text: 'You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n' +
          'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
          'http://' + req.headers.host + '/reset/' + token + '\n\n' +
          'If you did not request this, please ignore this email and your password will remain unchanged.\n'
      };
      transporter.sendMail(mailOptions, function(err) {
        req.flash('info', { msg: 'An e-mail has been sent to ' + user.email + ' with further instructions.' });
        done(err, 'done');
      });
    }
  ], function(err) {
    if (err) return next(err);
    res.redirect('/forgot');
  });
});


}; // end of module.exports