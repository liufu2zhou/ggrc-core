/*
 Copyright (C) 2018 Google Inc.
 Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>
 */

import {
  applyChangesToCustomAttributeValue,
  isEvidenceRequired,
  isCommentRequired,
}
  from '../../plugins/utils/ca-utils';
import {VALIDATION_ERROR, RELATED_ITEMS_LOADED} from '../../events/eventTypes';
import tracker from '../../tracker';
import Permission from '../../permission';

(function (GGRC, can) {
  'use strict';

  GGRC.Components('assessmentLocalCa', {
    tag: 'assessment-local-ca',
    viewModel: {
      instance: null,
      fields: [],
      isDirty: false,
      saving: false,
      highlightInvalidFields: false,

      define: {
        editMode: {
          type: 'boolean',
          value: false,
          set: function (newValue) {
            if (newValue === true) {
              this.attr('highlightInvalidFields', false);
            }
            return newValue;
          },
        },
        canEdit: {
          type: 'boolean',
          value: false,
          get: function () {
            return this.attr('editMode') &&
              Permission.is_allowed_for('update', this.attr('instance'));
          },
        },
        evidenceAmount: {
          type: 'number',
        },
        isEvidenceRequired: {
          get: function () {
            let optionsWithEvidence = this.attr('fields')
              .filter(function (item) {
                return item.attr('type') === 'dropdown';
              })
              .filter(function (item) {
                return isEvidenceRequired(item);
              }).length;
            return optionsWithEvidence > this.attr('evidenceAmount');
          },
        },
      },
      validateForm: function ({
        triggerField = null,
        triggerAttachmentModals = false,
        saveDfd = null,
      } = {}) {
        let hasValidationErrors = false;
        this.attr('fields')
          .each((field) => {
            this.performValidation(field);
            if ( !field.validation.valid ) {
              hasValidationErrors = true;
            }
            if ( triggerField === field &&
                 triggerAttachmentModals &&
                 field.validation.hasMissingInfo ) {
              this.dispatch({
                type: 'validationChanged',
                field,
                saveDfd,
              });
            }
          });

        if ( this.attr('instance') ) {
          this.attr('instance._hasValidationErrors', hasValidationErrors);
        }

        if ( hasValidationErrors ) {
          this.dispatch(VALIDATION_ERROR);
        }
      },
      performDropdownValidation(field) {
        let value = field.value;
        let isMandatory = field.validation.mandatory;
        let errorsMap = field.errorsMap || {
          evidence: false,
          comment: false,
        };

        let requiresEvidence = isEvidenceRequired(field);
        let requiresComment = isCommentRequired(field);

        let hasMissingEvidence = requiresEvidence &&
          this.attr('isEvidenceRequired');

        let hasMissingComment = requiresComment && !!errorsMap.comment;

        let fieldValid = (value) ?
          !(hasMissingEvidence || hasMissingComment) : !isMandatory;

        field.attr({
          validation: {
            show: isMandatory || !!value,
            valid: fieldValid,
            hasMissingInfo: (hasMissingEvidence || hasMissingComment),
            requiresAttachment: (requiresEvidence || requiresComment),
          },
          errorsMap: {
            evidence: hasMissingEvidence,
            comment: hasMissingComment,
          },
        });
      },
      performValidation: function (field) {
        let value = field.value;
        let isMandatory = field.validation.mandatory;

        if (field.type === 'checkbox') {
          if (value === '1') {
            value = true;
          } else if (value === '0') {
            value = false;
          }

          field.attr({
            validation: {
              show: isMandatory,
              valid: isMandatory ? !!(value) : true,
              hasMissingInfo: false,
            },
          });
        } else if (field.type === 'dropdown') {
          this.performDropdownValidation(field);
        } else {
          // validation for all other fields
          field.attr({
            validation: {
              show: isMandatory,
              valid: isMandatory ? !!(value) : true,
              hasMissingInfo: false,
            },
          });
        }
      },
      save: function (fieldId, fieldValue) {
        const self = this;
        const changes = {
          [fieldId]: fieldValue,
        };
        const stopFn = tracker.start(this.attr('instance.type'),
          tracker.USER_JOURNEY_KEYS.NAVIGATION,
          tracker.USER_ACTIONS.ASSESSMENT.EDIT_LCA);

        this.attr('isDirty', true);

        return this.attr('deferredSave').push(function () {
          let caValues = self.attr('instance.custom_attribute_values');
          applyChangesToCustomAttributeValue(
            caValues,
            new can.Map(changes));

          self.attr('saving', true);
        })
        // todo: error handling
          .always(() => {
            this.attr('saving', false);
            this.attr('isDirty', false);
            stopFn();
          });
      },
      attributeChanged: function (e) {
        e.field.attr('value', e.value);

        // Removes "link" with the comment for DD field and
        // makes it require a new one
        if ( e.field.attr('type') === 'dropdown' &&
          isCommentRequired(e.field) ) {
          e.field.attr('errorsMap.comment', true);
        }

        let saveDfd = this.save(e.fieldId, e.value);

        this.validateForm({
          triggerAttachmentModals: true,
          triggerField: e.field,
          saveDfd: saveDfd,
        });
      },
    },
    events: {
      '{viewModel} evidenceAmount': function () {
        this.viewModel.validateForm();
      },
      [`{viewModel.instance} ${RELATED_ITEMS_LOADED.type}`]: function () {
        this.viewModel.validateForm();
      },
      '{viewModel} fields'() {
        this.viewModel.validateForm();
      },
      '{viewModel.instance} showInvalidField': function (ev) {
        let pageType = GGRC.page_instance().type;
        let $container = (pageType === 'Assessment') ?
          $('.object-area') : $('.cms_controllers_info_pin');
        let $body = (pageType === 'Assessment') ?
          $('.inner-content.widget-area') : $('.info-pane__body');
        let field;
        let index;

        index = _.findIndex(this.viewModel.attr('fields'), function (field) {
          let validation = field.attr('validation');
          return validation.show && !validation.valid;
        });

        field = $('.field-wrapper')[index];

        if (!field) {
          return;
        }

        this.viewModel.attr('highlightInvalidFields', true);
        $container.animate({
          scrollTop: $(field).offset().top - $body.offset().top,
        }, 500);
      },
    },
    helpers: {
      isInvalidField: function (show, valid, highlightInvalidFields, options) {
        show = Mustache.resolve(show);
        valid = Mustache.resolve(valid);
        highlightInvalidFields = Mustache.resolve(highlightInvalidFields);

        if (highlightInvalidFields && show && !valid) {
          return options.fn(options.context);
        }
        return options.inverse(options.context);
      },
    },
  });
})(window.GGRC, window.can);
