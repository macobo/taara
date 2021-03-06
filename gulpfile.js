var _      = require('lodash');
var gulp   = require('gulp');
var merge  = require('merge2');
var tsc    = require('gulp-typescript');
var shell  = require('gulp-shell');
var runseq = require('run-sequence');
var tslint = require('gulp-tslint');

var projectConfig = {
  removeComments: false,
  noImplicitAny: false,
  target: "ES5",
  module: "commonjs"
}
var tsProject = tsc.createProject(_.defaults(projectConfig, {declaration: true}));
var tsTestProject = tsc.createProject(projectConfig);

gulp.task('default', ['lint', 'buildrun']);

// ** Running ** //

gulp.task('run', shell.task([
  'node app/build/index.js'
]));

// ** Testing ** //
gulp.task('test:mocha', shell.task(['mocha bin/test']));
gulp.task('test', function(cb) {
  runseq('build', 'test:mocha', cb);
});

// ** Watching ** //

gulp.task('watch', function () {
  gulp.watch(['lib/*.ts', 'test/*.ts'], ['test']);
});

// ** Compilation ** //

gulp.task('build', ['compile', 'lint']);

gulp.task('compile:app', function() {
  var tsResult = gulp
    .src(__dirname+"/lib/*.ts")
    .pipe(tsc(tsProject));
  return merge([
    tsResult.js.pipe(gulp.dest(__dirname + '/bin')),
    tsResult.dts.pipe(gulp.dest(__dirname + '/bin'))
  ]);
});
gulp.task('compile:test', function() {
  return gulp.src(__dirname+"/test/*.ts")
    .pipe(tsc(tsTestProject))
    .js.pipe(gulp.dest(__dirname + '/bin/test'))
});
gulp.task('compile', ['compile:app', 'compile:test']);

// ** Linting ** //

gulp.task('lint', function(){
  return gulp.src(['lib/*.ts', 'test/*.ts'])
    .pipe(tslint())
    .pipe(tslint.report('prose', {
      emitError: false
    }));
});
